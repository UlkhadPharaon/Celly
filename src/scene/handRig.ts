import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Vec3 } from '../types';
import { glowTexture } from './textures';
import {
  boneLocalQuaternion,
  dampQuaternion,
  jointAngleErrorDegrees,
  palmBasis,
  palmDeltaQuaternion,
  type PalmBasis
} from './handMath';

/** Longest hand span (wrist â†’ middle fingertip) in world units at container scale 1. */
const HAND_UNIT = 0.62;

/** Driven bones: everything except the four fingertip leaves and the wrist. */
const DRIVEN = [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19];
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

function glassMaterial(color: string, opacity: number): THREE.MeshPhysicalMaterial {
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

  private readonly restBones: RestBone[] = [];
  private readonly restQ = new Map<number, THREE.Quaternion>();
  private readonly restDirParent = new Map<number, THREE.Vector3>();
  private readonly lastBoneQ = new Map<number, THREE.Quaternion>();
  private readonly restBasis: PalmBasis;
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

  constructor(armature: THREE.Object3D, side: 'left' | 'right', baseRotation: THREE.Euler) {
    this.side = side;
    this.armature = armature;
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

    armature.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) {
        const idx = parseInt(obj.name.slice(0, 2), 10);
        if (!Number.isNaN(idx)) this.bones.set(idx, obj as THREE.Bone);
      }
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = glassMaterial(side === 'left' ? '#19b5ff' : '#8b5cf6', 0.88);
        mesh.material = mat;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        this.meshMaterials.push(mat);
        const report = inspectAndRepairSkin(mesh);
        if (report) this.skinReports.push(report);
      }
    });

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
    const live = palmBasis(P);
    if (!live.valid) {
      this.lastApplyMs = performance.now() - started;
      return;
    }
    const targetRoot = palmDeltaQuaternion(this.restBasis, live);

    if (!this.rootReady) {
      this.rootQ.copy(targetRoot);
      this.rootReady = true;
    } else {
      // A palm flip is a real 180 degree rotation, not a sign change. Slerp always takes the
      // short arc, and the exponential rate keeps tracking jitter below the mesh's resolution.
      this.rootQ.copy(dampQuaternion(this.rootQ, targetRoot, 24, dt));
    }
    this.container.quaternion.copy(this.rootQ);
    this.container.updateMatrixWorld(true);

    for (const rest of this.restBones) {
      const b = this.bones.get(rest.index);
      if (!b) continue;
      const targetWorld = new THREE.Vector3(
        P[rest.child].x - P[rest.index].x,
        P[rest.child].y - P[rest.index].y,
        P[rest.child].z - P[rest.index].z
      );
      if (targetWorld.lengthSq() < 1e-10) continue;
      targetWorld.normalize();

      const parentQ = new THREE.Quaternion();
      b.parent?.getWorldQuaternion(parentQ);
      const targetParent = targetWorld.applyQuaternion(parentQ.invert()).normalize();
      const desired = boneLocalQuaternion(
        rest.restDirParent,
        rest.restQuat,
        targetParent,
        rest.maxFlex
      );
      const previous = this.lastBoneQ.get(rest.index);
      const next = previous ? dampQuaternion(previous, desired, 34, dt) : desired.clone();
      this.lastBoneQ.set(rest.index, next);
      b.quaternion.copy(next);
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
      const next = dampQuaternion(bone.quaternion, q, 8, dt);
      bone.quaternion.copy(next);
      this.lastBoneQ.set(i, next);
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
    const mesh = Array.from({ length: 21 }, (_, i) => {
      const p = this.bones.get(i)?.getWorldPosition(new THREE.Vector3());
      return p ? vec(p) : { x: 0, y: 0, z: 0 };
    });
    this.lastAngleError = jointAngleErrorDegrees(world, mesh);

    const per: Record<string, number> = {};
    const ranges: Record<string, Array<readonly [number, number, number]>> = {
      thumb: [[0, 1, 2], [1, 2, 3], [2, 3, 4]],
      index: [[0, 5, 6], [5, 6, 7], [6, 7, 8]],
      middle: [[0, 9, 10], [9, 10, 11], [10, 11, 12]],
      ring: [[0, 13, 14], [13, 14, 15], [14, 15, 16]],
      pinky: [[0, 17, 18], [17, 18, 19], [18, 19, 20]]
    };
    for (const [name, chains] of Object.entries(ranges)) {
      per[name] = jointAngleErrorDegrees(world, mesh, chains);
    }
    this.lastPerFinger = per;
  }

  private updateGlow(): void {
    const a = this.bones.get(4)?.getWorldPosition(new THREE.Vector3());
    const b = this.bones.get(8)?.getWorldPosition(new THREE.Vector3());
    if (!a || !b) return;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.container.worldToLocal(mid);
    this.glow.position.copy(mid);
  }

  pinchWorld(out: THREE.Vector3): THREE.Vector3 | null {
    const a = this.bones.get(4)?.getWorldPosition(new THREE.Vector3());
    const b = this.bones.get(8)?.getWorldPosition(new THREE.Vector3());
    if (!a || !b) return null;
    return out.copy(a).add(b).multiplyScalar(0.5);
  }

  private updateMarkers(): void {
    if (!this.markers.visible) return;
    const attr = this.markerGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 21; i++) {
      const bone = this.bones.get(i);
      if (!bone) continue;
      const p = bone.getWorldPosition(new THREE.Vector3());
      this.container.worldToLocal(p);
      attr.setXYZ(i, p.x, p.y, p.z);
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
      const mat = m as THREE.MeshPhysicalMaterial;
      mat.opacity = v;
      mat.transparent = v < 0.999;
    }
  }

  /** Rest table, skin audit, anchor and angle error, exposed to the debug overlay. */
  debugState(): Record<string, unknown> {
    const wrist = this.bones.get(0)?.getWorldPosition(new THREE.Vector3());
    const palmNormalWorld = this.restBasis.y.clone().applyQuaternion(this.container.quaternion).normalize();
    return {
      side: this.side,
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
    return { side: this.side, procedural: true };
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

/** Loads the two armatures from the GLB; falls back to procedural hands on any failure. */
export async function loadHands(
  forceProcedural = false
): Promise<{ left: DrivenHand; right: DrivenHand; rigged: boolean }> {
  if (forceProcedural) {
    return { left: new ProceduralHand('left'), right: new ProceduralHand('right'), rigged: false };
  }
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(new URL(GLB_URL, document.baseURI).href);
    const left = findArmature(gltf.scene, 'L');
    const right = findArmature(gltf.scene, 'R');
    if (!left || !right) throw new Error('hand armatures not found in GLB');

    left.removeFromParent();
    right.removeFromParent();

    const l = new HandRig(left, 'left', new THREE.Euler(0, Math.PI, 0));
    const r = new HandRig(right, 'right', new THREE.Euler(0, Math.PI, 0));
    return { left: l, right: r, rigged: true };
  } catch (err) {
    console.warn('[celly] falling back to procedural hands:', err);
    return { left: new ProceduralHand('left'), right: new ProceduralHand('right'), rigged: false };
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
