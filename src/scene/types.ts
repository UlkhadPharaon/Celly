import type * as THREE from 'three';
import type { OrganelleId } from '../types';

export type { OrganelleId };

export interface CellPart {
  id: OrganelleId;
  label: string;
  group: THREE.Group;
  /** Bounding-sphere centre in cell-root local space. */
  center: THREE.Vector3;
  radius: number;
  basePosition: THREE.Vector3;
  baseRotation: THREE.Euler;
  phase: number;
  bobAmp: number;
  bobSpeed: number;
  spin: THREE.Vector3;
}
