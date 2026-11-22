import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CapsuleCollider,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
  type RapierRigidBody,
} from '@react-three/rapier';
import * as THREE from 'three';
import type { SpawnPoint } from '@ai-three-studio/shared';

export type ViewMode = 'edit' | 'third-person';

interface CharacterExplorerProps {
  spawnPoint: SpawnPoint;
  mode: ViewMode;
  respawnToken: number;
  onControlActive: (active: boolean) => void;
}

const MOVEMENT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'KeyR',
]);

export function CharacterExplorer({
  spawnPoint,
  mode,
  respawnToken,
  onControlActive,
}: CharacterExplorerProps) {
  const body = useRef<RapierRigidBody>(null);
  const avatar = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const controller = useRef<ReturnType<ReturnType<typeof useRapier>['world']['createCharacterController']> | null>(null);
  const keys = useRef(new Set<string>());
  const jump = useRef(false);
  const needsRespawn = useRef(true);
  const velocityY = useRef(0);
  const moving = useRef(false);
  const walkingPhase = useRef(0);
  const viewYaw = useRef(THREE.MathUtils.degToRad(spawnPoint.yawDeg) - Math.PI);
  const viewPitch = useRef(-0.15);
  const { world, rapier } = useRapier();
  const { camera, gl } = useThree();
  const vectors = useMemo(() => ({
    pivot: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    desired: new THREE.Vector3(),
    euler: new THREE.Euler(0, 0, 0, 'YXZ'),
  }), []);

  useEffect(() => {
    const next = world.createCharacterController(0.025);
    next.enableAutostep(0.3, 0.2, false);
    next.enableSnapToGround(0.25);
    next.setMaxSlopeClimbAngle(Math.PI / 4);
    next.setMinSlopeSlideAngle(Math.PI / 3);
    controller.current = next;
    return () => {
      controller.current = null;
      world.removeCharacterController(next);
    };
  }, [world]);

  useEffect(() => {
    needsRespawn.current = true;
  }, [respawnToken, spawnPoint.position, spawnPoint.yawDeg]);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', mode === 'edit' ? '3D 场景编辑视口' : '角色漫游视口，点击后使用 WASD 移动');
    let dragging = false;
    const clear = () => {
      keys.current.clear();
      jump.current = false;
      dragging = false;
      onControlActive(false);
    };
    clear();
    if (mode === 'edit') {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      return;
    }
    const isActive = () => document.pointerLockElement === canvas || document.activeElement === canvas;
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Escape' && isActive()) {
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        clear();
        canvas.blur();
        return;
      }
      if (!isActive() || !MOVEMENT_KEYS.has(event.code)) return;
      event.preventDefault();
      keys.current.add(event.code);
      if (event.code === 'Space' && !event.repeat) jump.current = true;
      if (event.code === 'KeyR' && !event.repeat) needsRespawn.current = true;
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.code);
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      canvas.focus({ preventScroll: true });
      dragging = true;
      onControlActive(true);
      if (document.pointerLockElement !== canvas) {
        try {
          const result = canvas.requestPointerLock?.();
          void result?.catch(() => {});
        } catch {
          // Embedded browsers may deny pointer lock; dragging remains available.
        }
      }
    };
    const pointerUp = () => { dragging = false; };
    const mouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas && !dragging) return;
      viewYaw.current -= event.movementX * 0.0025;
      viewPitch.current = THREE.MathUtils.clamp(viewPitch.current - event.movementY * 0.0025, -1.15, 0.85);
    };
    const lockChange = () => {
      if (document.pointerLockElement !== canvas) {
        clear();
        canvas.blur();
      } else {
        onControlActive(true);
      }
    };
    const visibilityChange = () => { if (document.hidden) clear(); };
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('blur', clear);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('mousemove', mouseMove);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', visibilityChange);
    document.addEventListener('pointerlockchange', lockChange);
    return () => {
      clear();
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('blur', clear);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('mousemove', mouseMove);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', visibilityChange);
      document.removeEventListener('pointerlockchange', lockChange);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
  }, [gl, mode, onControlActive]);

  useBeforePhysicsStep(() => {
    const rigidBody = body.current;
    const character = controller.current;
    if (!rigidBody || !character) return;
    const collider = rigidBody.collider(0);
    const position = rigidBody.translation();
    if (needsRespawn.current || position.y < spawnPoint.position[1] - 20) {
      const [x, y, z] = spawnPoint.position;
      // The validated spawn includes terrain surface height. A ray from the sky
      // would incorrectly choose tree canopies, roofs, or overhanging models.
      const spawn = { x, y: y + 0.85, z };
      rigidBody.setTranslation(spawn, true);
      rigidBody.setNextKinematicTranslation(spawn);
      viewYaw.current = THREE.MathUtils.degToRad(spawnPoint.yawDeg) - Math.PI;
      viewPitch.current = -0.15;
      if (avatar.current) avatar.current.rotation.y = viewYaw.current + Math.PI;
      velocityY.current = 0;
      needsRespawn.current = false;
      return;
    }
    const dt = world.timestep;
    const pressed = keys.current;
    let forward = 0;
    let strafe = 0;
    if (mode !== 'edit') {
      forward = Number(pressed.has('KeyW') || pressed.has('ArrowUp')) - Number(pressed.has('KeyS') || pressed.has('ArrowDown'));
      strafe = Number(pressed.has('KeyD') || pressed.has('ArrowRight')) - Number(pressed.has('KeyA') || pressed.has('ArrowLeft'));
    }
    const length = Math.hypot(forward, strafe);
    const speed = pressed.has('ShiftLeft') || pressed.has('ShiftRight') ? 7 : 4;
    const distance = length ? speed * dt / length : 0;
    const x = (-Math.sin(viewYaw.current) * forward + Math.cos(viewYaw.current) * strafe) * distance;
    const z = (-Math.cos(viewYaw.current) * forward - Math.sin(viewYaw.current) * strafe) * distance;
    if (character.computedGrounded() && velocityY.current <= 0) {
      velocityY.current = jump.current && mode !== 'edit' ? 7 : -0.5;
    }
    jump.current = false;
    velocityY.current = Math.max(-25, velocityY.current - 20 * dt);
    character.computeColliderMovement(collider, { x, y: velocityY.current * dt, z });
    const movement = character.computedMovement();
    rigidBody.setNextKinematicTranslation({
      x: position.x + movement.x,
      y: position.y + movement.y,
      z: position.z + movement.z,
    });
    if (velocityY.current > 0 && movement.y < velocityY.current * dt * 0.5) velocityY.current = 0;
    moving.current = Math.hypot(movement.x, movement.z) > 0.002;
    if (length && avatar.current) avatar.current.rotation.y = Math.atan2(x, z);
  });

  useFrame((_, delta) => {
    walkingPhase.current += delta * (moving.current ? 11 : 4);
    const stride = moving.current ? Math.sin(walkingPhase.current) * 0.65 : 0;
    if (leftLeg.current) leftLeg.current.rotation.x = stride;
    if (rightLeg.current) rightLeg.current.rotation.x = -stride;
    if (leftArm.current) leftArm.current.rotation.x = -stride * 0.75;
    if (rightArm.current) rightArm.current.rotation.x = stride * 0.75;
    if (mode === 'edit' || !body.current) return;
    const position = body.current.translation();
    vectors.pivot.set(position.x, position.y + 0.57, position.z);
    vectors.euler.set(viewPitch.current, viewYaw.current, 0);
    vectors.direction.set(0, 0, -1).applyEuler(vectors.euler);
    camera.quaternion.setFromEuler(vectors.euler);
    vectors.direction.negate();
    const hit = world.castRay(
      new rapier.Ray(vectors.pivot, vectors.direction), 4.8, true,
      undefined, undefined, body.current.collider(0), body.current,
    );
    const distance = hit ? Math.max(0.15, hit.timeOfImpact - 0.25) : 4.8;
    vectors.desired.copy(vectors.pivot).addScaledVector(vectors.direction, distance);
    camera.position.copy(vectors.desired);
  });

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[spawnPoint.position[0], spawnPoint.position[1] + 0.85, spawnPoint.position[2]]} enabledRotations={[false, false, false]} name="explorer-character">
      <CapsuleCollider args={[0.5, 0.3]} friction={0} />
      <group ref={avatar}>
        <mesh castShadow position={[0, 0.18, 0]}>
          <capsuleGeometry args={[0.24, 0.38, 4, 8]} />
          <meshStandardMaterial color="#39b9a5" roughness={0.85} />
        </mesh>
        <mesh castShadow position={[0, 0.64, 0]}>
          <sphereGeometry args={[0.23, 12, 10]} />
          <meshStandardMaterial color="#edc3a0" roughness={0.8} />
        </mesh>
        <mesh castShadow position={[0, 0.77, -0.015]}>
          <sphereGeometry args={[0.235, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#263d49" />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 0.075, 0.65, 0.205]}>
            <sphereGeometry args={[0.025, 6, 6]} />
            <meshStandardMaterial color="#172631" />
          </mesh>
        ))}
        <mesh castShadow position={[0, 0.2, -0.24]}>
          <boxGeometry args={[0.31, 0.4, 0.16]} />
          <meshStandardMaterial color="#e9b65b" roughness={0.9} />
        </mesh>
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? leftLeg : rightLeg} position={[side * 0.13, -0.15, 0]}>
            <mesh castShadow position={[0, -0.29, 0]}>
              <capsuleGeometry args={[0.095, 0.39, 3, 6]} />
              <meshStandardMaterial color="#293d55" roughness={0.9} />
            </mesh>
            <mesh castShadow position={[0, -0.58, 0.04]}>
              <boxGeometry args={[0.2, 0.13, 0.3]} />
              <meshStandardMaterial color="#15232d" />
            </mesh>
          </group>
        ))}
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? leftArm : rightArm} position={[side * 0.31, 0.35, 0]}>
            <mesh castShadow position={[0, -0.22, 0]}>
              <capsuleGeometry args={[0.075, 0.3, 3, 6]} />
              <meshStandardMaterial color="#edc3a0" roughness={0.8} />
            </mesh>
          </group>
        ))}
      </group>
    </RigidBody>
  );
}
