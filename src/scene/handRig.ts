import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Vec3 } from '../types';
import { glowTexture } from './textures';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Longest hand span (wrist → middle fingertip) in world units at container scale 1. */
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

export interface DrivenHand {
  readonly container: THREE.Group;
  readonly side: 'left' | 'right';
  apply(world: Vec3[], dt: number): void;
  /** World-space midpoint of thumb tip and index tip after the last apply(). */
  pinchWorld(out: THREE.Vector3): THREE.Vector3 | null;
  setFeedbackVisible(visible: boolean): void;
  setPinchGlow(active: boolean): void;
  resetCalibration(): void;
  setOpacity(v: number): void;
  dispose(): void;
}

/** Orthonormal hand frame: columns = spread, up, normal. */
export function frameFrom(p: Vec3[]): THREE.Matrix3 {
  const u = new THREE.Vector3(p[9].x - p[0].x, p[9].y - p[0].y, p[9].z - p[0].z);
  const s = new THREE.Vector3(p[5].x - p[17].x, p[5].y - p[17].y, p[5].z - p[17].z);
  const un = u.clone().normalize();
  s.sub(un.clone().multiplyScalar(s.dot(un))).normalize();
  const n = new THREE.Vector3().crossVectors(s, un).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, s).normalize();
  return new THREE.Matrix3().set(s.x, e2.x, n.x, s.y, e2.y, n.y, s.z, e2.z, n.z);
}

function quatFromMatrix3(m: THREE.Matrix3): THREE.Quaternion {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(m));
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

/** Rigged GLB hand retargeted from MediaPipe world landmarks. */
export class HandRig implements DrivenHand {
  readonly container = new THREE.Group();
  readonly side: 'left' | 'right';
  readonly armature: THREE.Object3D;
  readonly bones = new Map<number, THREE.Bone>();

  private readonly restQ = new Map<number, THREE.Quaternion>();
  private readonly dhfRest = new Map<number, THREE.Vector3>();
  private readonly ema = new Map<number, THREE.Vector3>();
  private readonly restLocalDir = new Map<number, THREE.Vector3>();
  private readonly F = new THREE.Matrix3();
  private readonly wristQ0 = new THREE.Quaternion();
  private F0: THREE.Matrix3 | null = null;
  private calibrationFrames = 0;
  private glow: THREE.Sprite;
  private markers: THREE.Points;
  private markerGeometry: THREE.BufferGeometry;
  private meshMaterials: THREE.Material[] = [];

  constructor(armature: THREE.Object3D, side: 'left' | 'right', baseRotation: THREE.Euler) {
    this.side = side;
    this.armature = armature;
    this.container.name = `hand:${side}`;
    this.container.add(armature);

    armature.rotation.copy(baseRotation);

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
      }
    });

    this.captureRest();
    this.normalizeSize();

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
  }

  private captureRest(): void {
    this.armature.updateWorldMatrix(true, true);
    const pos = new Map<number, THREE.Vector3>();
    for (const [i, bone] of this.bones) pos.set(i, bone.getWorldPosition(new THREE.Vector3()));

    this.F.copy(frameFrom([...Array(21)].map((_, i) => vec(pos.get(i)))));
    for (const j of DRIVEN) {
      const c = CHILD[j];
      const a = pos.get(j);
      const b = pos.get(c);
      if (!a || !b) continue;
      const dir = b.clone().sub(a).normalize();
      this.dhfRest.set(j, dir.clone().applyMatrix3(this.F.clone().transpose()));
    }
    for (const [i, bone] of this.bones) {
      this.restQ.set(i, bone.quaternion.clone());
      this.restLocalDir.set(i, Y_AXIS.clone().applyQuaternion(bone.quaternion).normalize());
    }
    this.bones.get(0)?.getWorldQuaternion(this.wristQ0);
  }

  /**
   * Every hand source is normalised to the same wrist → middle-tip span, so the layer scale
   * means the same thing for the GLB rig and the procedural fallback. Uniform scaling does
   * not affect the direction-based retargeting.
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

  resetCalibration(): void {
    this.F0 = null;
    this.calibrationFrames = 0;
    this.ema.clear();
    for (const [i, bone] of this.bones) {
      const q = this.restQ.get(i);
      if (q) bone.quaternion.copy(q);
    }
    this.armature.updateMatrixWorld(true);
  }

  apply(world: Vec3[], dt: number): void {
    if (world.length !== 21) return;
    const P = world;

    if (!this.F0) {
      if (++this.calibrationFrames >= 3) this.F0 = frameFrom(P);
      return;
    }

    const Fm = frameFrom(P);
    const Rm = Fm.clone().multiply(this.F0.clone().transpose());
    const qDelta = quatFromMatrix3(this.F.clone().multiply(Rm).multiply(this.F.clone().transpose()));
    this.setWrist(qDelta);

    for (const j of DRIVEN) {
      const c = CHILD[j];
      const d = new THREE.Vector3(P[c].x - P[j].x, P[c].y - P[j].y, P[c].z - P[j].z).normalize();
      const dhc = d.clone().applyMatrix3(Fm.clone().transpose());
      let e = this.ema.get(j);
      if (!e) {
        e = dhc;
        this.ema.set(j, e);
      } else {
        const k = 1 - Math.exp(-Math.min(0.08, dt) * 26);
        e.lerp(dhc, k).normalize();
      }
      this.setBoneDir(j, e);
    }

    this.updateGlow();
    this.updateMarkers();
  }

  private setWrist(qDeltaWorld: THREE.Quaternion): void {
    const b = this.bones.get(0);
    if (!b) return;
    const wantW = qDeltaWorld.clone().multiply(this.wristQ0);
    const pq = new THREE.Quaternion();
    b.parent?.getWorldQuaternion(pq);
    b.quaternion.copy(pq.invert().multiply(wantW));
    b.updateMatrixWorld(true);
  }

  private setBoneDir(j: number, dhf: THREE.Vector3): void {
    const b = this.bones.get(j);
    if (!b) return;
    const wq = new THREE.Quaternion();
    this.bones.get(0)?.getWorldQuaternion(wq);
    const targetWorld = dhf
      .clone()
      .applyMatrix3(this.F.clone())
      .applyQuaternion(wq.clone().multiply(this.wristQ0.clone().invert()));
    if (targetWorld.lengthSq() < 1e-8) return;
    targetWorld.normalize();

    const pq = new THREE.Quaternion();
    b.parent?.getWorldQuaternion(pq);
    const localDir = targetWorld.applyQuaternion(pq.invert());
    const restQ = this.restQ.get(j);
    const restLocalDir = this.restLocalDir.get(j);
    if (!restQ || !restLocalDir) return;
    const delta = new THREE.Quaternion().setFromUnitVectors(restLocalDir, localDir);
    b.quaternion.copy(delta.multiply(restQ));
    b.updateMatrixWorld(true);
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

  setFeedbackVisible(visible: boolean): void {
    this.markers.visible = visible;
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

/** Glassy skeletal hand used if the GLB is missing or fails to load. */
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

  apply(world: Vec3[], _dt: number): void {
    if (world.length !== 21) return;
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
        world[i].z * scale
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

function vec(p: THREE.Vector3 | undefined): Vec3 {
  return p ? { x: p.x, y: p.y, z: p.z } : { x: 0, y: 0, z: 0 };
}

const GLB_URL = 'hands_rigged.glb';

/** Loads the two armatures from the GLB; falls back to procedural hands on any failure. */
export async function loadHands(): Promise<{ left: DrivenHand; right: DrivenHand; rigged: boolean }> {
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
