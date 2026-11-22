import type { WorldObject } from '@ai-three-studio/shared';

export function getObjectLabelHeight(object: WorldObject): number {
  const scaleY = Math.max(0.4, object.transform.scale[1]);
  switch (object.kind) {
    case 'primitive':
      return object.transform.position[1] + Math.max(...object.transform.scale) * 0.75 + 0.4;
    case 'tower':
      return (
        Number(object.params?.height ?? 10) +
        (object.params?.variant === 'lighthouse' ? 3.2 : 2.2)
      ) * scaleY;
    case 'cabin':
      return 6.2 * scaleY;
    case 'house':
      return 5.3 * scaleY;
    case 'tent':
      return 4.2 * scaleY;
    case 'tree':
      return 5.6 * scaleY;
    case 'hill':
      return Math.max(2.4, scaleY * 1.2);
    case 'cloud':
      return 2.2 * scaleY;
    case 'lamp':
      return 4.4 * scaleY;
    case 'sign':
      return 2.6;
    default:
      return 2.2 * scaleY;
  }
}

export function getSelectionRadius(object: WorldObject): number {
  const footprint = Math.max(
    0.6,
    Math.min(1.8, Math.max(object.transform.scale[0], object.transform.scale[2])),
  );
  switch (object.kind) {
    case 'primitive':
      return Math.max(object.transform.scale[0], object.transform.scale[2]) * 0.55;
    case 'ground':
      return 2.6;
    case 'water':
      return 2.2;
    case 'hill':
      return 2.2;
    case 'cabin':
      return 2.9;
    case 'house':
      return 2.4;
    case 'tower':
      return 2.2;
    case 'tree':
      return 1;
    case 'lamp':
      return 0.55;
    case 'campfire':
      return 1.3;
    case 'cloud':
      return 1.8;
    case 'path':
      return 1.4;
    default:
      return 1.1 * footprint;
  }
}
