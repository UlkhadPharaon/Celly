import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import type { HandSide } from '../types';
import { synthHand } from '../core/replayHand';

/**
 * Low-poly skinned hand generated from the same synthetic landmarks the tests use.
 *
 * One SkinnedMesh per hand replaces the 10k-vertex authored GLB. The skin is hard-weighted
 * (one bone per vertex), which is enough for a stylised glass hand and keeps the vertex count
 * low. Joints overlap with rounded capsule ends so fingers do not open gaps when they fold.
 */

const BONE_NAMES = [
  '00_WRIST',
  '01_THUMB_CMC',
  '02_THUMB_MCP',
  '03_THUMB_IP',
  '04_THUMB_TIP',
  '05_INDEX_MCP',
  '06_INDEX_PIP',
  '07_INDEX_DIP',
  '08_INDEX_TIP',
  '09_MIDDLE_MCP',
  '10_MIDDLE_PIP',
  '11_MIDDLE_DIP',
  '12_MIDDLE_TIP',
  '13_RING_MCP',
  '14_RING_PIP',
  '15_RING_DIP',
  '16_RING_TIP',
  '17_PINKY_MCP',
  '18_PINKY_PIP',
  '19_PINKY_DIP',
  '20_PINKY_TIP'
] as const;

const PARENT: Record<number, number> = {
  1: 0, 2: 1, 3: 2, 4: 3,
  5: 0, 6: 5, 7: 6, 8: 7,
  9: 0, 10: 9, 11: 10, 12: 11,
  13: 0, 14: 13, 15: 14, 16: 15,
  17: 0, 18: 17, 19: 18, 20: 19
};

const LINKS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [17, 18], [18, 19], [19, 20]
];

/** Metres, tuned against the synthetic hand's 0.094 m wrist→middle-MCP span. */
const RADIUS: Record<number, number> = {
  0: 0.024,
  1: 0.019, 2: 0.017, 3: 0.015, 4: 0.013,
  5: 0.018, 6: 0.016, 7: 0.014, 8: 0.012,
  9: 0.019, 10: 0.017, 11: 0.015, 12: 0.0125,
  13: 0.0175, 14: 0.0155, 15: 0.0135, 16: 0.0115,
  17: 0.016, 18: 0.014, 19: 0.012, 20: 0.0105
};

const UP = new THREE.Vector3(0, 1, 0);

export interface LowPolyHand {
  armature: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  vertices: number;
  triangles: number;
}

/**
 * Builds one hand. Geometry is authored for the right hand, then mirrored on X for the left.
 * Bone rest positions and mesh vertices are in the same armature-local space, with the wrist
 * at the origin, so `HandRig` can use its existing wrist-root contract unchanged.
 */
export function createLowPolyHand(side: HandSide): LowPolyHand {
  const source = synthHand('right', 0, 0, 0, { width: 1000, height: 1000 }).world;
  const wrist = source[0];
  const points = source.map(
    (p) => new THREE.Vector3(p.x - wrist.x, p.y - wrist.y, p.z - wrist.z)
  );
  if (side === 'left') for (const p of points) p.x *= -1;

  const bones: THREE.Bone[] = [];
  for (let i = 0; i < 21; i++) {
    const bone = new THREE.Bone();
    bone.name = BONE_NAMES[i];
    const parent = PARENT[i];
    if (parent === undefined) {
      bone.position.set(0, 0, 0);
    } else {
      bone.position.copy(points[i]).sub(points[parent]);
    }
    bones.push(bone);
  }

  const armature = new THREE.Group();
  armature.name = `Armature_LowPoly_${side === 'left' ? 'L' : 'R'}`;
  for (let i = 0; i < bones.length; i++) {
    const parent = PARENT[i];
    if (parent === undefined) armature.add(bones[i]);
    else bones[parent].add(bones[i]);
  }

  const builder = new MeshBuilder();
  addPalm(builder, points);
  addForearm(builder, points);

  for (const [a, b] of LINKS) {
    // [0,1] is the thumb metacarpal: it belongs to the thumb CMC bone, not the wrist.
    const bone = a === 0 ? b : a;
    addCapsule(builder, points[a], points[b], (RADIUS[a] + RADIUS[b]) * 0.5, bone);
  }

  // Knuckle bulges hide the hard-weight seam where a finger meets the palm.
  for (const index of [1, 5, 9, 13, 17]) {
    const sphere = new THREE.SphereGeometry(RADIUS[index] * 1.05, 8, 6);
    builder.add(sphere, new THREE.Matrix4().makeTranslation(points[index].x, points[index].y, points[index].z), index);
    sphere.dispose();
  }

  const geometry = builder.build();
  const material = new THREE.MeshStandardMaterial({
    color: side === 'left' ? '#57c8ff' : '#9b7bff',
    emissive: side === 'left' ? '#0d5f86' : '#352076',
    emissiveIntensity: 0.85,
    roughness: 0.28,
    metalness: 0.08,
    transparent: true,
    opacity: 0.9,
    depthWrite: true,
    side: THREE.FrontSide
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = side === 'left' ? 'Hand_L' : 'Hand_R';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;

  // Bone matrixWorld must be current before the skeleton computes its inverses. Without this
  // every bone inverse is identity, so each part is translated to its bone's world rest position
  // at skinning time and the hand comes apart.
  armature.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  armature.add(mesh);
  mesh.bind(skeleton);

  return {
    armature,
    mesh,
    bones,
    vertices: geometry.getAttribute('position').count,
    triangles: geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3
  };
}

/** Convex palm slab from the wrist to the four knuckles, plus a short forearm stump. */
function addPalm(builder: MeshBuilder, points: THREE.Vector3[]): void {
  const along = points[9].clone().sub(points[0]).normalize();
  const across = points[5].clone().sub(points[17]).normalize();
  // Symmetric thickness, so the sign of the palm normal does not matter for the hull.
  const normal = new THREE.Vector3().crossVectors(along, across).normalize();
  const thickness = 0.0115;
  const hull: THREE.Vector3[] = [];

  const pushPair = (base: THREE.Vector3, halfAcross: number): void => {
    for (const side of [-1, 1]) {
      const p = base.clone().addScaledVector(across, side * halfAcross);
      hull.push(
        p.clone().addScaledVector(normal, thickness),
        p.clone().addScaledVector(normal, -thickness)
      );
    }
  };

  pushPair(points[0], 0.019);
  pushPair(points[0].clone().addScaledVector(along, -0.012), 0.017);
  pushPair(points[1], 0.008);

  const centre = points[0].clone().lerp(points[9], 0.56);
  pushPair(centre, points[5].distanceTo(points[17]) * 0.31);

  for (const index of [5, 9, 13, 17]) {
    pushPair(points[index], 0.003);
    hull.push(
      points[index].clone().addScaledVector(normal, thickness * 0.65),
      points[index].clone().addScaledVector(normal, -thickness * 0.65)
    );
  }

  const palm = new ConvexGeometry(hull);
  builder.add(palm, new THREE.Matrix4(), 0);
  palm.dispose();
}

function addForearm(builder: MeshBuilder, points: THREE.Vector3[]): void {
  const along = points[9].clone().sub(points[0]).normalize();
  const end = points[0].clone().addScaledVector(along, -0.085);
  addCapsule(builder, points[0], end, 0.026, 0);
}

function addCapsule(
  builder: MeshBuilder,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  bone: number
): void {
  const dir = b.clone().sub(a);
  const length = dir.length();
  if (length < 1e-6) return;
  const height = Math.max(0.001, length - radius * 1.3);
  const geometry = new THREE.CapsuleGeometry(radius, height, 2, 6);
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  const matrix = new THREE.Matrix4().compose(midpoint, quaternion, new THREE.Vector3(1, 1, 1));
  builder.add(geometry, matrix, bone);
  geometry.dispose();
}

/** Accumulates transformed primitives into one indexed geometry with 4-influence skin data. */
class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly indices: number[] = [];
  private readonly skinIndices: number[] = [];
  private readonly skinWeights: number[] = [];

  add(source: THREE.BufferGeometry, matrix: THREE.Matrix4, bone: number): void {
    const geometry = source.clone();
    geometry.applyMatrix4(matrix);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();

    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const base = this.positions.length / 3;
    for (let i = 0; i < position.count; i++) {
      this.positions.push(position.getX(i), position.getY(i), position.getZ(i));
      this.normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      this.skinIndices.push(bone, 0, 0, 0);
      this.skinWeights.push(1, 0, 0, 0);
    }

    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) this.indices.push(base + index.getX(i));
    } else {
      for (let i = 0; i < position.count; i++) this.indices.push(base + i);
    }
    geometry.dispose();
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeights, 4));
    geometry.setIndex(this.indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}
