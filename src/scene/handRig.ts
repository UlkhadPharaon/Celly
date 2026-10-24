import * as THREE from 'three';
import type { Vec3 } from '../types';
import { glowTexture } from './textures';
import { createLowPolyHand } from './lowPolyHand';
import {
  boneLocalQuaternion,
  createPalmBasis,
  dampQuaternion,
  jointAngleErrorDegrees,
  palmBasis,
  palmBasisInto,
  palmDeltaQuaternion,
  type PalmBasis
} from './handMath';

/** Longest hand span (wrist â†’ middle fingertip) in world units at container scale 1. */
const HAND_UNIT = 0.62;

/** Driven bones: everything except the four fingertip leaves and the wrist. */
const DRIVEN = [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19];
const FINGER_CHAINS: ReadonlyArray<
  readonly [string, ReadonlyArray<readonly [number, number, number]>]
> = [
  ['thumb', [[0, 1, 2], [1, 2, 3], [2, 3, 4]]],
  ['index', [[0, 5, 6], [5, 6, 7], [6, 7, 8]]],
  ['middle', [[0, 9, 10], [9, 10, 11], [10, 11, 12]]],
  ['ring', [[0, 13, 14], [13, 14, 15], [14, 15, 16]]],
  ['pinky', [[0, 17, 18], [17, 18, 19], [18, 19, 20]]]
];
const CHILD: Record<number, number> = {
  1: 2,
  2: 3,
  3: 4,
  5: 6,
  6: 7,
  7: 8,
  9: 10,
  10: 11,
  11: 12,
  13: 14,
  14: 15,
  15: 16,
  17: 18,
  18: 19,
  19: 20
};

const PARENT_LANDMARK: Record<number, number> = {
  1: 0, 2: 1, 3: 2,
  5: 0, 6: 5, 7: 6,
  9: 0, 10: 9, 11: 10,
  13: 0, 14: 13, 15: 14,
  17: 0, 18: 17, 19: 18
};

const CHAIN_NAMES: Record<number, string> = {
  1: 'thumb', 2: 'thumb', 3: 'thumb',
  5: 'index', 6: 'index', 7: 'index',
  9: 'middle', 10: 'middle', 11: 'middle',
  13: 'ring', 14: 'ring', 15: 'ring',
  17: 'pinky', 18: 'pinky', 19: 'pinky'
};

/**
 * Soft anatomical limits. They are deliberately generous: these are guard rails against a bad
 * landmark frame, not a second animation layer. The thumb gets its own looser 3-DOF budget.
 */
const MAX_FLEX: Record<number, number> = {
  1: 1.15, 2: 1.35, 3: 1.25,
  5: 1.62, 6: 1.92, 7: 1.62,
  9: 1.62, 10: 1.95, 11: 1.62,
  13: 1.62, 14: 1.95, 15: 1.62,
  17: 1.55, 18: 1.9, 19: 1.6
};

export interface DrivenHand {
  readonly container: THREE.Group;
  readonly side: 'left' | 'right';
  apply(world: Vec3[], dt: number, confidence?: number): void;
  /** World-space midpoint of thumb tip and index tip after the last apply(). */
  pinchWorld(out: THREE.Vector3): THREE.Vector3 | null;
  setFeedbackVisible(visible: boolean): void;
  setPinchGlow(active: boolean): void;
  resetCalibration(): void;
  setOpacity(v: number): void;
  dispose(): void;
  debugState?(): Record<string, unknown>;
}

export type HandSource = 'lowpoly' | 'glb' | 'skeletal';

interface HandRigOptions {
  cheapMaterial?: boolean;
  source?: HandSource;
}

interface RestBone {
  index: number;
  child: number;
  parentLandmark: number;
  chain: string;
  restDirParent: THREE.Vector3;
  restQuat: THREE.Quaternion;
  maxFlex: number;
}

interface SkinReport {
  mesh: string;
  vertices: number;
  unweighted: number;
  over4: number;
  weightSumMin: number;
  weightSumMax: number;
  repaired: boolean;
  bindMatricesFinite: boolean;
  bones: number;
  boneLengthStable: boolean;
}

/** Orthonormal hand frame: columns = index-pinky, palm-up, wrist-middle-MCP. */
export function frameFrom(p: Vec3[]): THREE.Matrix3 {
  return palmBasis(p).matrix;
}

function glassMaterial(
  color: string,
  opacity: number,
  cheap = false
): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  if (cheap) {
    // One standard material per hand instead of clearcoat physical shading. The emissive tint
    // keeps the glass look while removing the most expensive BRDF lobe on low-end GPUs.
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.62,
      roughness: 0.26,
      metalness: 0.08,
      transparent: true,
      opacity,
      depthWrite: true,
      side: THREE.FrontSide
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.7,
    roughness: 0.18,
    metalness: 0.05,
    clearcoat: 0.8,
    clearcoatRoughness: 0.25,
    transparent: true,
    opacity,
    depthWrite: true,
    side: THREE.FrontSide
  });
}

/**
 * Rigged GLB hand retargeted from MediaPipe world landmarks.
 *
 * The rig's armature origin and its `00_WRIST` bone head are the same point *after* the glTF
 * scene translation is removed. The container is therefore a true wrist root: position is the
 * mapped wrist, quaternion is `livePalm * inverse(restPalm)`. The wrist bone itself is never
 * translated or rotated, so the skin cannot orbit or candy-wrapper around a hidden offset.
 */
export class HandRig implements DrivenHand {
  readonly container = new THREE.Group();
  readonly side: 'left' | 'right';
  readonly armature: THREE.Object3D;
  readonly bones = new Map<number, THREE.Bone>();
  readonly source: HandSource;

  private readonly restBones: RestBone[] = [];
  private readonly restQ = new Map<number, THREE.Quaternion>();
  private readonly restDirParent = new Map<number, THREE.Vector3>();
  private readonly lastBoneQ = new Map<number, THREE.Quaternion>();
  private readonly restBasis: PalmBasis;
  private readonly liveBasis = createPalmBasis();
  private readonly restTipLength: number;
  private readonly rootQ = new THREE.Quaternion();
  private rootReady = false;
  private glow: THREE.Sprite;
  private markers: THREE.Points;
  private trackedPoints: THREE.Points;
  private trackedLines: THREE.LineSegments;
  private markerGeometry: THREE.BufferGeometry;
  private trackedGeometry: THREE.BufferGeometry;
  private trackedLineGeometry: THREE.BufferGeometry;
  private meshMaterials: THREE.Material[] = [];
  private skinReports: SkinReport[] = [];
  private lastAngleError = 0;
  private lastPerFinger: Record<string, number> = {};
  /** CPU time spent in the last retarget+solve; used by the debug readout and latency checks. */
  private lastApplyMs = 0;
  private meshVertices = 0;
  private meshTriangles = 0;
  private meshDrawCalls = 0;

  // Reused solver scratch. `apply()` runs at display rate, so allocating a handful of vectors
  // per bone per frame becomes measurable GC pressure on phones.
  private readonly tmpTargetWorld = new THREE.Vector3();
  private readonly tmpParentQ = new THREE.Quaternion();
  private readonly tmpTargetParent = new THREE.Vector3();
  private readonly tmpDesired = new THREE.Quaternion();
  private readonly tmpRootTarget = new THREE.Quaternion();
  private readonly tmpVecA = new THREE.Vector3();
  private readonly tmpVecB = new THREE.Vector3();
  private readonly tmpVecC = new THREE.Vector3();
  private readonly meshSample: Vec3[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));

  constructor(
    armature: THREE.Object3D,
    side: 'left' | 'right',
    baseRotation: THREE.Euler,
    options: HandRigOptions = {}
  ) {
    this.side = side;
    this.armature = armature;
    this.source = options.source ?? 'glb';
    this.container.name = `hand:${side}`;
    this.container.add(armature);

    /*
     * glTF stores the hand at its world placement (the armature node has a translation, e.g.
     * +0.10, -0.047, +0.0855 for the left hand). That translation is not part of the wrist
     * joint: the `00_WRIST` bone head is local (0,0,0). Keeping it would put the visual wrist
     * away from the container origin and make every rotation look like an orbit. Strip it once.
     */
    armature.position.set(0, 0, 0);
    armature.rotation.copy(baseRotation);
    armature.scale.set(1, 1, 1);
    armature.updateMatrixWorld(true);

    const staleMaterials = new Set<THREE.Material>();
    armature.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) {
        const idx = parseInt(obj.name.slice(0, 2), 10);
        if (!Number.isNaN(idx)) this.bones.set(idx, obj as THREE.Bone);
      }
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = glassMaterial(
          side === 'left' ? '#19b5ff' : '#8b5cf6',
          0.88,
          options.cheapMaterial
        );
        const previous = mesh.material;
        mesh.material = mat;
        if (Array.isArray(previous)) previous.forEach((m) => staleMaterials.add(m));
        else if (previous) staleMaterials.add(previous);
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        this.meshMaterials.push(mat);
        const position = mesh.geometry.getAttribute('position');
        this.meshVertices += position?.count ?? 0;
        const index = mesh.geometry.getIndex();
        this.meshTriangles += index ? index.count / 3 : (position?.count ?? 0) / 3;
        this.meshDrawCalls += 1;
        const report = inspectAndRepairSkin(mesh);
        if (report) this.skinReports.push(report);
      }
    });
    for (const material of staleMaterials) material.dispose();

    this.restBasis = this.captureRest();
    this.normalizeSize();
    this.restTipLength = this.measureTipLength();

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: new THREE.Color('#ffd166'),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
      })
    );
    this.glow.scale.setScalar(0.09);
    this.container.add(this.glow);

    this.markerGeometry = new THREE.BufferGeometry();
    this.markerGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(21 * 3), 3));
    this.markers = new THREE.Points(
      this.markerGeometry,
      new THREE.PointsMaterial({
        color: new THREE.Color('#c9f2ff'),
        size: 0.012,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
      })
    );
    this.markers.visible = false;
    this.container.add(this.markers);

    this.trackedGeometry = new THREE.BufferGeometry();
    this.trackedGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(21 * 3), 3));
    this.trackedPoints = new THREE.Points(
      this.trackedGeometry,
      new THREE.PointsMaterial({
        color: new THREE.Color('#ffd166'),
        size: 0.016,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
      })
    );
    this.trackedPoints.visible = false;
    this.trackedPoints.renderOrder = 5;
    this.container.add(this.trackedPoints);

    const links = handLinks();
    this.trackedLineGeometry = new THREE.BufferGeometry();
    this.trackedLineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(links.length * 2 * 3), 3)
    );
    this.trackedLines = new THREE.LineSegments(
      this.trackedLineGeometry,
      new THREE.LineBasicMaterial({
        color: new THREE.Color('#ffd166'),
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        depthTest: false
      })
    );
    this.trackedLines.visible = false;
    this.trackedLines.renderOrder = 5;
    this.container.add(this.trackedLines);

    // Debug frame: RGB axes at the wrist + one arrow along the mesh palm normal. They are only
    // created after the rest basis is captured, and only shown with the landmark feedback.
    this.axes = new THREE.AxesHelper(0.11);
    this.axes.visible = false;
    this.axes.renderOrder = 6;
    const axesMat = this.axes.material as THREE.LineBasicMaterial;
    axesMat.depthTest = false;
    axesMat.transparent = true;
    axesMat.opacity = 0.9;
    this.container.add(this.axes);

    this.palmNormal = new THREE.ArrowHelper(
      this.restBasis.y.clone().normalize(),
      new THREE.Vector3(0, 0, 0),
      0.17,
      0xffd166,
      0.035,
      0.022
    );
    this.palmNormal.visible = false;
    this.palmNormal.renderOrder = 6;
    (this.palmNormal.line.material as THREE.Material).depthTest = false;
    (this.palmNormal.cone.material as THREE.Material).depthTest = false;
    this.container.add(this.palmNormal);

    this.trackedLinks = links;
  }

  private readonly axes: THREE.AxesHelper;
  private readonly palmNormal: THREE.ArrowHelper;
  private trackedLinks: Array<[number, number]>;

  private captureRest(): PalmBasis {
    this.container.updateMatrixWorld(true);
    const pos = new Map<number, THREE.Vector3>();
    for (const [i, bone] of this.bones) pos.set(i, bone.getWorldPosition(new THREE.Vector3()));

    const sample: Vec3[] = Array.from({ length: 21 }, (_, i) => vec(pos.get(i)));
    const basis = palmBasis(sample);

    this.restBones.length = 0;
    for (const j of DRIVEN) {
      const child = CHILD[j];
      const b = this.bones.get(j);
      const c = this.bones.get(child);
      if (!b || !c) continue;
      const parentQ = new THREE.Quaternion();
      b.parent?.getWorldQuaternion(parentQ);
      const worldDir = c.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
      const restDirParent = worldDir.applyQuaternion(parentQ.invert()).normalize();
      const restQuat = b.quaternion.clone();
      this.restQ.set(j, restQuat.clone());
      this.restDirParent.set(j, restDirParent.clone());
      this.lastBoneQ.set(j, restQuat.clone());
      this.restBones.push({
        index: j,
        child,
        parentLandmark: PARENT_LANDMARK[j] ?? 0,
        chain: CHAIN_NAMES[j] ?? 'finger',
        restDirParent,
        restQuat,
        maxFlex: MAX_FLEX[j] ?? 1.6
      });
    }
    return basis;
  }

  /**
   * The GLB's mesh is authored in metres. Scale the armature so wrist â†’ middle fingertip is
   * HAND_UNIT before the layer applies its display scale. Uniform scale cannot introduce
   * stretching, and the wrist remains at the scaled origin.
   */
  private normalizeSize(): void {
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    for (const bone of this.bones.values()) box.expandByPoint(bone.getWorldPosition(p));
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z);
    if (span > 1e-6) this.armature.scale.multiplyScalar(HAND_UNIT / span);
    this.armature.updateMatrixWorld(true);
  }

  private measureTipLength(): number {
    const a = this.bones.get(0)?.getWorldPosition(new THREE.Vector3());
    const b = this.bones.get(12)?.getWorldPosition(new THREE.Vector3());
    return a && b ? a.distanceTo(b) : HAND_UNIT;
  }

  resetCalibration(): void {
    this.rootReady = false;
    this.rootQ.identity();
    this.container.quaternion.identity();
    this.lastAngleError = 0;
    this.lastPerFinger = {};
    this.lastApplyMs = 0;
    for (const [i, bone] of this.bones) {
      const q = this.restQ.get(i);
      if (q) bone.quaternion.copy(q);
    }
    this.armature.updateMatrixWorld(true);
  }

  apply(world: Vec3[], dt: number, confidence = 1): void {
    if (world.length !== 21) return;
    const started = performance.now();
    if (confidence < 0.3) {
      this.easeToRest(dt);
      this.lastApplyMs = performance.now() - started;
      return;
    }

    const P = world;
    const live = palmBasisInto(P, this.liveBasis);
    if (!live.valid) {
      this.lastApplyMs = performance.now() - started;
      return;
    }
    const targetRoot = palmDeltaQuaternion(this.restBasis, live, this.tmpRootTarget);

    if (!this.rootReady) {
      this.rootQ.copy(targetRoot);
      this.rootReady = true;
    } else {
      // A palm flip is a real 180 degree rotation, not a sign change. Slerp always takes the
      // short arc, and the exponential rate keeps tracking jitter below the mesh's resolution.
      dampQuaternion(this.rootQ, targetRoot, 24, dt, this.rootQ);
    }
    this.container.quaternion.copy(this.rootQ);
    this.container.updateMatrixWorld(true);

    for (const rest of this.restBones) {
      const b = this.bones.get(rest.index);
      if (!b) continue;
      this.tmpTargetWorld.set(
        P[rest.child].x - P[rest.index].x,
        P[rest.child].y - P[rest.index].y,
        P[rest.child].z - P[rest.index].z
      );
      if (this.tmpTargetWorld.lengthSq() < 1e-10) continue;
      this.tmpTargetWorld.normalize();

      b.parent?.getWorldQuaternion(this.tmpParentQ);
      this.tmpTargetParent
        .copy(this.tmpTargetWorld)
        .applyQuaternion(this.tmpParentQ.invert())
        .normalize();
      boneLocalQuaternion(
        rest.restDirParent,
        rest.restQuat,
        this.tmpTargetParent,
        rest.maxFlex,
        this.tmpDesired
      );
      const previous = this.lastBoneQ.get(rest.index);
      if (previous) {
        dampQuaternion(previous, this.tmpDesired, 34, dt, previous);
        b.quaternion.copy(previous);
      } else {
        b.quaternion.copy(this.tmpDesired);
        this.lastBoneQ.set(rest.index, this.tmpDesired.clone());
      }
      b.updateWorldMatrix(true, false);
    }

    // Fingertips are children of DIPs, but their bone transforms are unchanged in the table.
    this.updateAngleError(P);
    this.updateGlow();
    this.updateMarkers();
    this.updateTracked(P);
    this.lastApplyMs = performance.now() - started;
  }

  private easeToRest(dt: number): void {
    for (const [i, bone] of this.bones) {
      const q = this.restQ.get(i);
      if (!q) continue;
      const previous = this.lastBoneQ.get(i) ?? bone.quaternion;
      dampQuaternion(previous, q, 8, dt, previous);
      bone.quaternion.copy(previous);
      this.lastBoneQ.set(i, previous);
      bone.updateWorldMatrix(true, false);
    }
    this.updateAngleError(null);
  }

  private updateAngleError(world: Vec3[] | null): void {
    if (!world) {
      this.lastAngleError = 0;
      this.lastPerFinger = {};
      return;
    }
    for (let i = 0; i < 21; i++) {
      const bone = this.bones.get(i);
      if (bone) bone.getWorldPosition(this.tmpVecA);
      const sample = this.meshSample[i];
      sample.x = this.tmpVecA.x;
      sample.y = this.tmpVecA.y;
      sample.z = this.tmpVecA.z;
    }
    this.lastAngleError = jointAngleErrorDegrees(world, this.meshSample);

    const per: Record<string, number> = this.lastPerFinger;
    for (const [name, chains] of FINGER_CHAINS) {
      per[name] = jointAngleErrorDegrees(world, this.meshSample, chains);
    }
  }

  private updateGlow(): void {
    const a = this.bones.get(4);
    const b = this.bones.get(8);
    if (!a || !b) return;
    a.getWorldPosition(this.tmpVecA);
    b.getWorldPosition(this.tmpVecB);
    this.tmpVecC.copy(this.tmpVecA).add(this.tmpVecB).multiplyScalar(0.5);
    this.container.worldToLocal(this.tmpVecC);
    this.glow.position.copy(this.tmpVecC);
  }

  pinchWorld(out: THREE.Vector3): THREE.Vector3 | null {
    const a = this.bones.get(4);
    const b = this.bones.get(8);
    if (!a || !b) return null;
    a.getWorldPosition(this.tmpVecA);
    b.getWorldPosition(this.tmpVecB);
    return out.copy(this.tmpVecA).add(this.tmpVecB).multiplyScalar(0.5);
  }

  private updateMarkers(): void {
    if (!this.markers.visible) return;
    const attr = this.markerGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 21; i++) {
      const bone = this.bones.get(i);
      if (!bone) continue;
      bone.getWorldPosition(this.tmpVecA);
      this.container.worldToLocal(this.tmpVecA);
      attr.setXYZ(i, this.tmpVecA.x, this.tmpVecA.y, this.tmpVecA.z);
    }
    attr.needsUpdate = true;
  }

  /**
   * Raw MediaPipe landmarks overlaid in the rig's local space. Scaling by the live wristâ†’tip
   * length makes the yellow skeleton and the mesh comparable without changing either one.
   */
  private updateTracked(world: Vec3[]): void {
    if (!this.trackedPoints.visible) return;
    const wrist = world[0];
    const tip = world[12] ?? world[9];
    const liveLength = Math.hypot(tip.x - wrist.x, tip.y - wrist.y, tip.z - wrist.z);
    const scale = liveLength > 1e-6 ? this.restTipLength / liveLength : 1;
    const attr = this.trackedGeometry.getAttribute('position') as THREE.BufferAttribute;
    const lineAttr = this.trackedLineGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 21; i++) {
      const p = world[i];
      attr.setXYZ(i, (p.x - wrist.x) * scale, (p.y - wrist.y) * scale, (p.z - wrist.z) * scale);
    }
    let slot = 0;
    for (const [a, b] of this.trackedLinks) {
      lineAttr.setXYZ(slot++, (world[a].x - wrist.x) * scale, (world[a].y - wrist.y) * scale, (world[a].z - wrist.z) * scale);
      lineAttr.setXYZ(slot++, (world[b].x - wrist.x) * scale, (world[b].y - wrist.y) * scale, (world[b].z - wrist.z) * scale);
    }
    attr.needsUpdate = true;
    lineAttr.needsUpdate = true;
  }

  setFeedbackVisible(visible: boolean): void {
    this.markers.visible = visible;
    this.trackedPoints.visible = visible;
    this.trackedLines.visible = visible;
    this.axes.visible = visible;
    this.palmNormal.visible = visible;
  }

  setPinchGlow(active: boolean): void {
    const mat = this.glow.material as THREE.SpriteMaterial;
    mat.opacity = active ? 0.95 : 0;
  }

  setOpacity(v: number): void {
    for (const m of this.meshMaterials) {
      m.opacity = v;
      m.transparent = v < 0.999;
    }
  }

  /** Rest table, skin audit, anchor and angle error, exposed to the debug overlay. */
  debugState(): Record<string, unknown> {
    const wrist = this.bones.get(0)?.getWorldPosition(new THREE.Vector3());
    const palmNormalWorld = this.restBasis.y.clone().applyQuaternion(this.container.quaternion).normalize();
    return {
      side: this.side,
      source: this.source,
      mesh: {
        vertices: this.meshVertices,
        triangles: Math.round(this.meshTriangles),
        drawCalls: this.meshDrawCalls,
        material: this.meshMaterials[0]?.type ?? null
      },
      wrist: wrist ? [wrist.x, wrist.y, wrist.z] : null,
      rootPosition: [this.container.position.x, this.container.position.y, this.container.position.z],
      rootQuaternion: [this.rootQ.x, this.rootQ.y, this.rootQ.z, this.rootQ.w],
      palmNormal: palmNormalWorld.toArray().map((n) => Number(n.toFixed(4))),
      angleErrorDeg: Number(this.lastAngleError.toFixed(2)),
      applyMs: Number(this.lastApplyMs.toFixed(2)),
      perFingerDeg: Object.fromEntries(
        Object.entries(this.lastPerFinger).map(([k, v]) => [k, Number(v.toFixed(2))])
      ),
      restBasis: {
        x: this.restBasis.x.toArray(),
        y: this.restBasis.y.toArray(),
        z: this.restBasis.z.toArray(),
        valid: this.restBasis.valid
      },
      restTable: this.restBones.map((r) => ({
        bone: this.bones.get(r.index)?.name ?? String(r.index),
        child: this.bones.get(r.child)?.name ?? String(r.child),
        parentLandmark: r.parentLandmark,
        chain: r.chain,
        restDir: r.restDirParent.toArray().map((n) => Number(n.toFixed(4))),
        restQuat: r.restQuat.toArray().map((n) => Number(n.toFixed(4))),
        maxFlexDeg: Math.round((r.maxFlex * 180) / Math.PI)
      })),
      skin: this.skinReports,
      // Current bone lengths, in world units. The solver only changes rotations, so these should
      // stay constant across poses; the verification harness checks their coefficient of variation.
      boneLengths: Object.fromEntries(
        this.restBones.map((r) => {
          const b = this.bones.get(r.index);
          const c = this.bones.get(r.child);
          const length =
            b && c ? b.getWorldPosition(new THREE.Vector3()).distanceTo(c.getWorldPosition(new THREE.Vector3())) : 0;
          return [b?.name ?? String(r.index), Number(length.toFixed(5))];
        })
      )
    };
  }

  dispose(): void {
    this.container.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    const gm = this.glow.material as THREE.SpriteMaterial;
    gm.map?.dispose();
    gm.dispose();
  }
}

/** Glassy skeletal hand used if the GLB is missing, fails to load, or is forced in settings. */
export class ProceduralHand implements DrivenHand {
  readonly container = new THREE.Group();
  readonly side: 'left' | 'right';
  private joints: THREE.Mesh[] = [];
  private bones: THREE.Mesh[] = [];
  private glow: THREE.Sprite;
  private markers: THREE.Points;

  constructor(side: 'left' | 'right') {
    this.side = side;
    this.container.name = `hand-proc:${side}`;
    const mat = glassMaterial(side === 'left' ? '#57c8ff' : '#8f7bff', 0.5);
    const jointGeo = new THREE.SphereGeometry(0.016, 10, 8);
    const boneGeo = new THREE.CapsuleGeometry(0.006, 1, 4, 8);
    for (let i = 0; i < 21; i++) {
      const m = new THREE.Mesh(jointGeo, mat);
      m.frustumCulled = false;
      this.container.add(m);
      this.joints.push(m);
    }
    const links: Array<[number, number]> = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [0, 9], [9, 10], [10, 11], [11, 12],
      [0, 13], [13, 14], [14, 15], [15, 16],
      [0, 17], [17, 18], [18, 19], [19, 20]
    ];
    for (let i = 0; i < links.length; i++) {
      const m = new THREE.Mesh(boneGeo, mat);
      m.frustumCulled = false;
      this.container.add(m);
      this.bones.push(m);
    }
    this.links = links;

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: new THREE.Color('#ffd166'),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
      })
    );
    this.glow.scale.setScalar(0.09);
    this.container.add(this.glow);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(21 * 3), 3));
    this.markers = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: new THREE.Color('#c9f2ff'),
        size: 0.012,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    this.markers.visible = false;
    this.container.add(this.markers);
  }

  private links: Array<[number, number]>;

  apply(world: Vec3[], _dt: number, confidence = 1): void {
    if (world.length !== 21) return;
    if (confidence < 0.3) return;
    // Centre on the wrist and normalise to the same span as the rigged hand.
    const span = Math.hypot(
      world[12].x - world[0].x,
      world[12].y - world[0].y,
      world[12].z - world[0].z
    );
    const scale = span > 1e-6 ? HAND_UNIT / span : 3.2;
    for (let i = 0; i < 21; i++) {
      this.joints[i].position.set(
        (world[i].x - world[0].x) * scale,
        (world[i].y - world[0].y) * scale,
        (world[i].z - world[0].z) * scale
      );
    }
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.links.length; i++) {
      const [a, b] = this.links[i];
      const pa = this.joints[a].position;
      const pb = this.joints[b].position;
      const dir = pb.clone().sub(pa);
      const len = dir.length();
      const mesh = this.bones[i];
      mesh.position.copy(pa).addScaledVector(dir, 0.5);
      mesh.scale.set(1, Math.max(0.001, len), 1);
      mesh.quaternion.setFromUnitVectors(up, dir.normalize());
    }
    const mid = this.joints[4].position.clone().add(this.joints[8].position).multiplyScalar(0.5);
    this.glow.position.copy(mid);
  }

  pinchWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (this.joints.length < 9) return null;
    this.container.updateMatrixWorld(true);
    out.copy(this.joints[4].position).add(this.joints[8].position).multiplyScalar(0.5);
    return this.container.localToWorld(out);
  }

  setFeedbackVisible(visible: boolean): void {
    this.markers.visible = visible;
  }

  setPinchGlow(active: boolean): void {
    (this.glow.material as THREE.SpriteMaterial).opacity = active ? 0.95 : 0;
  }

  setOpacity(v: number): void {
    this.container.traverse((o) => {
      const m = o as THREE.Mesh;
      const mat = m.material as THREE.MeshPhysicalMaterial | undefined;
      if (mat && mat.isMeshPhysicalMaterial) mat.opacity = v;
    });
  }

  resetCalibration(): void {
    /* stateless */
  }

  debugState(): Record<string, unknown> {
    return { side: this.side, source: 'skeletal', procedural: true };
  }

  dispose(): void {
    this.container.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }
}

function handLinks(): Array<[number, number]> {
  return [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20]
  ];
}

/** Normalise skin weights to 4 influences and report whether the bind data is healthy. */
function inspectAndRepairSkin(mesh: THREE.Mesh): SkinReport | null {
  const geometry = mesh.geometry;
  const weight = geometry.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
  const index = geometry.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
  if (!weight || !index) return null;

  let unweighted = 0;
  let over4 = 0;
  let min = Infinity;
  let max = 0;
  let repaired = false;
  const w = weight.array as ArrayLike<number>;
  const idx = index.array as ArrayLike<number>;
  const itemSize = weight.itemSize;

  for (let v = 0; v < weight.count; v++) {
    const base = v * itemSize;
    let sum = 0;
    let influences = 0;
    const entries: Array<[number, number]> = [];
    for (let k = 0; k < itemSize; k++) {
      const value = w[base + k];
      if (value > 1e-5) {
        influences++;
        sum += value;
      }
      entries.push([idx[base + k], value]);
    }
    if (influences === 0) unweighted++;
    if (influences > 4) over4++;
    min = Math.min(min, sum);
    max = Math.max(max, sum);

    if (influences > 0 && Math.abs(sum - 1) > 1e-4) {
      for (let k = 0; k < itemSize; k++) (w as number[])[base + k] = w[base + k] / sum;
      repaired = true;
    }
    if (influences > 4) {
      entries.sort((a, b) => b[1] - a[1]);
      for (let k = 0; k < itemSize; k++) {
        (w as number[])[base + k] = k < 4 ? entries[k][1] / sum : 0;
        (idx as number[])[base + k] = entries[k][0];
      }
      repaired = true;
    }
  }
  if (repaired) {
    weight.needsUpdate = true;
    index.needsUpdate = true;
  }

  const skinned = mesh as THREE.SkinnedMesh;
  let bindMatricesFinite = true;
  if (skinned.isSkinnedMesh) {
    for (const m of skinned.skeleton.boneInverses) {
      if (!m.elements.every(Number.isFinite)) bindMatricesFinite = false;
    }
  }
  let boneLengthStable = true;
  if (skinned.isSkinnedMesh) {
    for (const bone of skinned.skeleton.bones) {
      if (!Number.isFinite(bone.position.x + bone.position.y + bone.position.z)) boneLengthStable = false;
    }
  }

  return {
    mesh: mesh.name || 'hand',
    vertices: weight.count,
    unweighted,
    over4,
    weightSumMin: Number.isFinite(min) ? Number(min.toFixed(4)) : 0,
    weightSumMax: Number(max.toFixed(4)),
    repaired,
    bindMatricesFinite,
    bones: skinned.isSkinnedMesh ? skinned.skeleton.bones.length : 0,
    boneLengthStable
  };
}

function vec(p: THREE.Vector3 | undefined): Vec3 {
  return p ? { x: p.x, y: p.y, z: p.z } : { x: 0, y: 0, z: 0 };
}

const GLB_URL = 'hands_rigged.glb';

export interface LoadedHands {
  left: DrivenHand;
  right: DrivenHand;
  rigged: boolean;
  source: HandSource;
}

/**
 * Loads the generated low-poly skinned hands. The authored GLB is opt-in (`?hands=glb`) so the
 * default boot does not download or parse 1.3 MB of high-detail geometry. The old skeletal hand
 * remains the explicit diagnostic fallback in settings.
 */
export async function loadHands(forceProcedural = false): Promise<LoadedHands> {
  if (forceProcedural) {
    return {
      left: new ProceduralHand('left'),
      right: new ProceduralHand('right'),
      rigged: false,
      source: 'skeletal'
    };
  }

  if (new URLSearchParams(window.location.search).get('hands') === 'glb') {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(new URL(GLB_URL, document.baseURI).href);
      const left = findArmature(gltf.scene, 'L');
      const right = findArmature(gltf.scene, 'R');
      if (!left || !right) throw new Error('hand armatures not found in GLB');

      left.removeFromParent();
      right.removeFromParent();

      const l = new HandRig(left, 'left', new THREE.Euler(0, Math.PI, 0), { source: 'glb' });
      const r = new HandRig(right, 'right', new THREE.Euler(0, Math.PI, 0), { source: 'glb' });
      return { left: l, right: r, rigged: true, source: 'glb' };
    } catch (err) {
      console.warn('[celly] high-detail hands unavailable, using generated low-poly hands:', err);
    }
  }

  try {
    const left = createLowPolyHand('left');
    const right = createLowPolyHand('right');
    return {
      left: new HandRig(left.armature, 'left', new THREE.Euler(0, 0, 0), {
        cheapMaterial: true,
        source: 'lowpoly'
      }),
      right: new HandRig(right.armature, 'right', new THREE.Euler(0, 0, 0), {
        cheapMaterial: true,
        source: 'lowpoly'
      }),
      rigged: true,
      source: 'lowpoly'
    };
  } catch (err) {
    console.warn('[celly] low-poly hand generation failed, using skeletal fallback:', err);
    return {
      left: new ProceduralHand('left'),
      right: new ProceduralHand('right'),
      rigged: false,
      source: 'skeletal'
    };
  }
}

/**
 * The shipped GLB names its roots `Armature_Hand_L` / `Armature_Hand_R`; older exports used
 * the reverse order. Accept either so a re-export never silently drops to the fallback.
 */
function findArmature(root: THREE.Object3D, side: 'L' | 'R'): THREE.Object3D | null {
  for (const name of [`Armature_Hand_${side}`, `Hand_${side}_Armature`]) {
    const found = root.getObjectByName(name);
    if (found) return found;
  }
  return null;
}
