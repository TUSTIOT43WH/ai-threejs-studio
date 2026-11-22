import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { CharacterExplorer, type ViewMode } from './CharacterExplorer';
import { Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { WorldObject, WorldSchema } from '@ai-three-studio/shared';
import { OBJECT_KIND_LABELS } from '../../lib/labels';
import { getSceneTheme } from '../../lib/environment-visuals';
import { SceneAtmosphere } from './atmosphere';
import { downloadSceneModule } from '../../lib/scene-export';
import { WorldObjectView, type ObjectAssetStatus } from './world-objects';
import { objectNeedsResources } from '../../lib/scene-resources';
import { SceneRendering, ViewportCamera } from './SceneRendering';
import {
  getObjectLabelHeight,
  getSelectionRadius,
} from './world-object-geometry';

interface SceneViewportProps {
  world: WorldSchema;
  selectedObjectId: string | null;
  onSelectObject: (objectId: string | null) => void;
  gridVisible: boolean;
  resetToken: number;
  viewMode: ViewMode;
  respawnToken: number;
  onControlActive: (active: boolean) => void;
  exportToken: number;
  onExportResult: (message: string) => void;
}

interface BoundaryState {
  failed: boolean;
}

class SceneErrorBoundary extends Component<
  { children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#0a0d12] p-8 text-center">
          <div className="text-sm font-medium text-white/80">
            3D 视口渲染失败
          </div>
          <p className="max-w-sm text-xs leading-relaxed text-white/45">
            请确认浏览器已启用 WebGL / 硬件加速，然后刷新页面重试。世界数据不会丢失。
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

function SelectionMarker({
  object,
  accent,
}: {
  object: WorldObject;
  accent: string;
}) {
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const outerMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const radius = getSelectionRadius(object);
  const height = getObjectLabelHeight(object);
  const [x, , z] = object.transform.position;

  useFrame((state) => {
    const pulse = 0.58 + Math.sin(state.clock.elapsedTime * 3.1) * 0.22;
    if (material.current) material.current.opacity = pulse;
    if (outerMaterial.current) {
      outerMaterial.current.opacity = 0.18 + Math.sin(state.clock.elapsedTime * 2.2) * 0.08;
    }
  });

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.1, z]}>
        <ringGeometry args={[radius, radius + 0.09, 64]} />
        <meshBasicMaterial
          ref={material}
          color={accent}
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.095, z]}>
        <ringGeometry args={[radius + 0.35, radius + 0.4, 64]} />
        <meshBasicMaterial
          ref={outerMaterial}
          color={accent}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <Html
        center
        distanceFactor={22}
        position={[x, height, z]}
        zIndexRange={[30, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div className="world-label">
          {object.name}
          <span className="ml-2 text-mint-300/60">
            {OBJECT_KIND_LABELS[object.kind]}
          </span>
        </div>
      </Html>
    </group>
  );
}

interface SceneLoadProps {
  restoreToken: number;
  retryToken: number;
  assetsReady: boolean;
  onAssetStatus: (id: string, status: ObjectAssetStatus) => void;
}

function SceneContent({
  world,
  selectedObjectId,
  onSelectObject,
  gridVisible,
  viewMode,
  respawnToken,
  onControlActive,
  exportToken,
  onExportResult,
  restoreToken,
  retryToken,
  assetsReady,
  onAssetStatus,
}: Omit<SceneViewportProps, 'resetToken'> & SceneLoadProps) {
  const { scene } = useThree();
  const lastExport = useRef(exportToken);
  useEffect(() => {
    if (lastExport.current === exportToken) return;
    lastExport.current = exportToken;
    try {
      downloadSceneModule(scene, world);
      onExportResult('已导出当前预览的 .three.js 静态模型文件；可在安装 three 的项目中导入 createWorld()。');
    } catch (reason) {
      onExportResult(reason instanceof Error ? reason.message : '导出失败，请等待场景加载后重试。');
    }
  }, [exportToken, scene, world, onExportResult]);
  const theme = useMemo(
    () => getSceneTheme(world.environment),
    [world.environment],
  );
  const selectedObject = useMemo(
    () => world.objects.find((object) => object.id === selectedObjectId) ?? null,
    [world.objects, selectedObjectId],
  );

  return (
    <>
      <color attach="background" args={[world.render?.sky?.bottomColor ?? theme.skyBottom]} />
      <ViewportCamera world={world} mode={viewMode} restoreToken={restoreToken} />
      <SceneRendering render={world.render} />
      <SceneAtmosphere environment={world.environment} theme={theme} render={world.render} />
      {gridVisible ? (
        <Grid
          args={[90, 90]}
          position={[0, 0.08, 0]}
          cellSize={1.4}
          cellThickness={0.4}
          cellColor="#2b6b68"
          sectionSize={7}
          sectionThickness={0.8}
          sectionColor="#5b6ba8"
          fadeDistance={70}
          fadeStrength={2}
          infiniteGrid
        />
      ) : null}
      <Suspense fallback={<Html center><div role="status" className="rounded bg-black/80 p-3 text-sm text-white">正在初始化场景物理…</div></Html>}>
        <Physics gravity={[0, -20, 0]} timeStep={1 / 60}>
          {world.objects.map((object) => (
            <WorldObjectView
              key={object.id}
              object={object}
              environment={world.environment}
              theme={theme}
              resources={world.resources}
              retryToken={retryToken}
              onAssetStatus={onAssetStatus}
              selected={viewMode === 'edit' && object.id === selectedObjectId}
              onSelect={viewMode === 'edit' ? onSelectObject : () => {}}
            />
          ))}
          {assetsReady ? <CharacterExplorer
            spawnPoint={world.spawnPoint}
            mode={viewMode}
            respawnToken={respawnToken}
            onControlActive={onControlActive}
          /> : null}
        </Physics>
      </Suspense>
      {selectedObject && viewMode === 'edit' ? (
        <SelectionMarker object={selectedObject} accent={theme.accent} />
      ) : null}
    </>
  );
}

function initialCamera(world: WorldSchema): [number, number, number] {
  if (world.render?.camera) return world.render.camera.position;
  const [x, y, z] = world.spawnPoint.position;
  return [x + 11, y + 8.4, z + 13];
}

export function SceneViewport({
  world,
  selectedObjectId,
  onSelectObject,
  gridVisible,
  resetToken,
  viewMode,
  respawnToken,
  onControlActive,
  exportToken,
  onExportResult,
}: SceneViewportProps) {
  const [restoreToken, setRestoreToken] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const [statuses, setStatuses] = useState<Record<string, ObjectAssetStatus>>({});
  const onAssetStatus = useCallback((id: string, status: ObjectAssetStatus) => {
    setStatuses((previous) => previous[id]?.state === status.state && previous[id]?.message === status.message ? previous : { ...previous, [id]: status });
  }, []);
  const assetObjects = world.objects.filter(objectNeedsResources);
  const pending = assetObjects.filter((object) => statuses[object.id]?.state !== 'ready');
  const errors = pending.filter((object) => statuses[object.id]?.state === 'error');
  const assetsReady = pending.length === 0;
  return (
    <div className="canvas-container relative h-full w-full overflow-hidden bg-[#0a0d12]">
      <div className="absolute right-3 top-3 z-40 flex max-w-sm flex-col items-end gap-2">
        {viewMode === 'edit' ? <button type="button" className="rounded border border-white/20 bg-black/70 px-3 py-2 text-xs text-white" onClick={() => setRestoreToken((value) => value + 1)}>恢复参考镜头</button> : null}
        {pending.length > 0 ? <div role="status" className="max-h-52 overflow-auto rounded bg-black/85 p-3 text-xs text-white">
          <p>{errors.length ? `${errors.length} 个素材加载失败，漫游与导出暂不可用。` : `正在加载 ${pending.length} 个素材，完成后可漫游与导出…`}</p>
          {errors.map((object) => <p key={object.id} className="mt-2">{object.name}：{statuses[object.id]?.message}</p>)}
          {errors.length > 0 ? <button type="button" className="mt-2 underline" onClick={() => setRetryToken((value) => value + 1)}>重试素材加载</button> : null}
        </div> : null}
        {world.assetRequirements?.length ? <details className="rounded bg-black/80 p-3 text-xs text-white">
          <summary>需要补充 {world.assetRequirements.length} 个素材</summary>
          <p className="mt-2">请在素材库上传对应文件后重新生成或关联物体。当前场景未代替这些缺失素材。</p>
          {world.assetRequirements.map((item, index) => <p key={index} className="mt-2">{item.name}：{item.description}</p>)}
        </details> : null}
      </div>
      <SceneErrorBoundary key={`${world.id}:${resetToken}`}>
        <Canvas
          key={resetToken}
          shadows="percentage"
          dpr={[1, 2]}
          camera={{
            position: initialCamera(world),
            fov: 48,
            near: 0.1,
            far: 420,
          }}
          gl={{
            antialias: true,
            powerPreference: 'high-performance',
          }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.02;
          }}
          onPointerMissed={() => { if (viewMode === 'edit') onSelectObject(null); }}
          fallback={
            <div
              aria-hidden="true"
              className="flex h-full items-center justify-center p-8 text-center text-sm text-white/50"
            >
              当前浏览器不支持 WebGL，无法显示 3D 世界。
            </div>
          }
        >
          <SceneContent
            world={world}
            selectedObjectId={selectedObjectId}
            onSelectObject={onSelectObject}
            gridVisible={gridVisible}
            viewMode={viewMode}
            respawnToken={respawnToken}
            onControlActive={onControlActive}
            exportToken={exportToken}
            onExportResult={onExportResult}
            restoreToken={restoreToken}
            retryToken={retryToken}
            assetsReady={assetsReady}
            onAssetStatus={onAssetStatus}
          />
        </Canvas>
      </SceneErrorBoundary>
    </div>
  );
}
