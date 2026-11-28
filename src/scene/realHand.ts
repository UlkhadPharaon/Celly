import * as THREE from 'three';
import type { HandSide, Vec3 } from '../types';
import { clamp, damp } from '../core/math';
import { glowTexture } from './textures';
import { createPalmBasis, palmBasisInto } from './handMath';

/**
 * Finger phalanx segments: [jointA, jointB, baseRadius, tipRadius].
 * Radii are in metres at reference hand scale; scaled dynamically with the live palm span.
 */
const PHALANX_SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
  // Thumb (CMC -> MCP -> IP -> TIP)
  [1, 2, 0.0155, 0.0135],
  [2, 3, 0.0130, 0.0112],
  [3, 4, 0.0108, 0.0088],
  // Index (MCP -> PIP -> DIP -> TIP)
  [5, 6, 0.0118, 0.0102],
  [6, 7, 0.0098, 0.0085],
  [7, 8, 0.0082, 0.0068],
  // Middle
  [9, 10, 0.0122, 0.0105],
  [10, 11, 0.0102, 0.0088],
  [11, 12, 0.0085, 0.0070],
  // Ring
  [13, 14, 0.0112, 0.0096],
  [14, 15, 0.0094, 0.0080],
  [15, 16, 0.0078, 0.0065],
  // Pinky
  [17, 18, 0.0098, 0.0084],
  [18, 19, 0.0080, 0.0068],
  [19, 20, 0.0066, 0.0055],
  // Thenar web & wrist-thumb bridge
  [0, 1, 0.0185, 0.0160]
];

const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;
const FINGERTIP_PREV = [3, 7, 11, 15, 19] as const;
const FINGERTIP_RADII = [0.0088, 0.0072, 0.0074, 0.0068, 0.0058] as const;

const JOINT_RADII: ReadonlyArray<number> = [
  0.022, // 0 wrist
  0.016, 0.0135, 0.0112, 0.0090, // 1..4 thumb
  0.0125, 0.0104, 0.0086, 0.0070, // 5..8 index
  0.0128, 0.0106, 0.0088, 0.0072, // 9..12 middle
  0.0118, 0.0098, 0.0082, 0.0067, // 13..16 ring
  0.0104, 0.0085, 0.0070, 0.0057 // 17..20 pinky
];

const UP = new THREE.Vector3(0, 1, 0);
const GLOW_COLOR = new THREE.Color('#ff9f45');

const SKIN_BASE: Record<HandSide, string> = {
  left: '#e3b49b',
  right: '#e6b8a0'
};
const SKIN_SHEEN: Record<HandSide, string> = {
  left: '#9bf6df',
  right: '#ffe3a3'
};

/**
 * Create a unit-height (y in [-0.5, 0.5]) anatomically tapered phalanx lathe geometry.
 * Slightly wider at the proximal base and distal condyle with a gentle waist in the middle.
 */
function createPhalanxGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 = base (a), 1 = tip (b)
    const y = t - 0.5;
    // Slight hourglass/condyle profile: 1.0 at base, 0.88 mid, 0.94 near tip, tapering slightly
    const waist = 1 - 0.1 * Math.sin(t * Math.PI);
    const taper = 1 - 0.14 * t;
    pts.push(new THREE.Vector2(waist * taper, y));
  }
  const geo = new THREE.LatheGeometry(pts, 14);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Dynamic sculpted palm mesh built from 6 dorsal + 6 palmar + 2 center-arch vertices
 * driven directly by MediaPipe landmarks [0, 1, 5, 9, 13, 17] and the palm normal.
 * Zero per-frame allocations: updates its Float32Array position buffer in place.
 */
function createPalmMesh(material: THREE.Material): {
  mesh: THREE.Mesh;
  positions: Float32Array;
  geo: THREE.BufferGeometry;
} {
  // 14 vertices:
  // 0..5: dorsal ring [0(wrist), 1(cmc), 5(idx), 9(mid), 13(ring), 17(pinky)]
  // 6..11: palmar ring [0, 1, 5, 9, 13, 17]
  // 12: dorsal center arch, 13: palmar center hollow
  const positions = new Float32Array(14 * 3);
  const indices = [
    // Dorsal fan (top surface, normal = +palmY)
    12, 0, 1,
    12, 1, 2,
    12, 2, 3,
    12, 3, 4,
    12, 4, 5,
    12, 5, 0,
    // Palmar fan (bottom surface, normal = -palmY)
    13, 7, 6,
    13, 8, 7,
    13, 9, 8,
    13, 10, 9,
    13, 11, 10,
    13, 6, 11,
    // Side walls around the palm perimeter (0->1->2->3->4->5->0)
    0, 6, 7, 0, 7, 1,
    1, 7, 8, 1, 8, 2,
    2, 8, 9, 2, 9, 3,
    3, 9, 10, 3, 10, 4,
    4, 10, 11, 4, 11, 5,
    5, 11, 6, 5, 6, 0
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { mesh, positions, geo };
}

/**
 * Purpose-built, MediaPipe-native sculpted 3D human hand.
 *
 * Every joint, tapered phalanx, fingernail, and the deformable 3D palm are driven directly by the
 * 21 filtered 3D landmarks — eliminating external GLB bind-pose twists, bone-roll mismatches, and
 * mirror-chirality flips. Works 100% offline with zero async model-loading delay.
 */
export class RealHand {
  readonly container = new THREE.Group();
  readonly side: HandSide;

  private readonly material: THREE.MeshPhysicalMaterial;
  private readonly nailMaterial: THREE.MeshPhysicalMaterial;
  private readonly glowMaterial: THREE.SpriteMaterial;
  private readonly glowMap: THREE.Texture;
  private readonly glow: THREE.Sprite;

  private readonly jointGeo: THREE.BufferGeometry;
  private readonly phalanxGeo: THREE.BufferGeometry;
  private readonly nailGeo: THREE.BufferGeometry;
  private readonly joints: THREE.Mesh[] = [];
  private readonly segments: Array<{ mesh: THREE.Mesh; a: number; b: number; ra: number }> = [];
  private readonly nails: THREE.Mesh[] = [];
  private readonly palm: { mesh: THREE.Mesh; positions: Float32Array; geo: THREE.BufferGeometry };

  // Reusable scratch objects (zero per-frame allocations)
  private readonly smoothedPoints: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3());
  private readonly livePalm = createPalmBasis();
  private readonly pinchPos = new THREE.Vector3();
  private readonly segDir = new THREE.Vector3();
  private readonly segQuat = new THREE.Quaternion();
  private readonly palmNormal = new THREE.Vector3();
  private readonly palmCenter = new THREE.Vector3();
  private readonly nailMatrix = new THREE.Matrix4();
  private readonly nailRight = new THREE.Vector3();
  private readonly nailUp = new THREE.Vector3();

  private feedbackVisible = true;
  private pinchActive = false;
  private pinchStrength = 0;
  private opacity = 1;
  private hasPose = false;
  private lastApplyMs = 0;

  constructor(side: HandSide) {
    this.side = side;
    this.container.name = `hand-real-${side}`;

    this.material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(SKIN_BASE[side]),
      roughness: 0.45,
      metalness: 0.02,
      clearcoat: 0.14,
      clearcoatRoughness: 0.45,
      sheen: 0.45,
      sheenRoughness: 0.52,
      sheenColor: new THREE.Color(SKIN_SHEEN[side]),
      emissive: new THREE.Color('#1a0e0a'),
      emissiveIntensity: 0.1,
      transparent: true,
      opacity: 0.94,
      depthTest: true,
      depthWrite: true
    });

    this.nailMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#f5dfd4'),
      roughness: 0.22,
      metalness: 0.04,
      clearcoat: 0.55,
      clearcoatRoughness: 0.2,
      transparent: true,
      opacity: 0.96,
      depthTest: true,
      depthWrite: true
    });

    this.jointGeo = new THREE.SphereGeometry(1, 14, 10);
    for (let i = 0; i < 21; i++) {
      const m = new THREE.Mesh(this.jointGeo, this.material);
      m.renderOrder = 5;
      m.frustumCulled = false;
      this.joints.push(m);
      this.container.add(m);
    }

    this.phalanxGeo = createPhalanxGeometry();
    for (const [a, b, ra] of PHALANX_SEGMENTS) {
      const m = new THREE.Mesh(this.phalanxGeo, this.material);
      m.renderOrder = 5;
      m.frustumCulled = false;
      this.segments.push({ mesh: m, a, b, ra });
      this.container.add(m);
    }

    this.nailGeo = new THREE.SphereGeometry(1, 10, 8);
    this.nailGeo.scale(0.85, 1.15, 0.28);
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(this.nailGeo, this.nailMaterial);
      m.renderOrder = 5;
      m.frustumCulled = false;
      this.nails.push(m);
      this.container.add(m);
    }

    this.palm = createPalmMesh(this.material);
    this.container.add(this.palm.mesh);

    this.glowMap = glowTexture(64);
    this.glowMaterial = new THREE.SpriteMaterial({
      map: this.glowMap,
      color: new THREE.Color(GLOW_COLOR),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false
    });
    this.glow = new THREE.Sprite(this.glowMaterial);
    this.glow.renderOrder = 7;
    this.glow.visible = false;
    this.container.add(this.glow);
  }

  setResolution(_width: number, _height: number, _pixelRatio: number): void {
    // Kept for HandLayer interface parity.
  }

  setMirrored(_mirrorX: boolean): void {
    // Purpose-built landmark mesh adapts natively to both mirrored and unmirrored chirality.
  }

  setFeedbackVisible(visible: boolean): void {
    this.feedbackVisible = visible;
    if (!visible) {
      this.glow.visible = false;
      this.pinchStrength = 0;
    }
  }

  setPinchGlow(pinching: boolean): void {
    this.pinchActive = pinching;
  }

  resetCalibration(): void {
    this.hasPose = false;
  }

  pinchWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.hasPose) return null;
    return out.copy(this.pinchPos);
  }

  landmarkWorld(out: THREE.Vector3, index: number): THREE.Vector3 | null {
    if (!this.hasPose || index < 0 || index > 20) return null;
    return out.copy(this.smoothedPoints[index]);
  }

  debugState(): Record<string, unknown> {
    return {
      side: this.side,
      rigReady: true,
      visible: this.container.visible,
      pinching: this.pinchActive,
      opacity: this.opacity,
      indexTip: {
        x: this.smoothedPoints[8].x,
        y: this.smoothedPoints[8].y,
        z: this.smoothedPoints[8].z
      }
    };
  }

  apply(
    points: THREE.Vector3[],
    pinchPoint: Vec3 | null,
    dt: number,
    confidence = 1,
    glowScale = 0.24
  ): void {
    if (points.length < 21) return;

    const now = performance.now();
    const isFresh = !this.hasPose || now - this.lastApplyMs > 280;
    this.lastApplyMs = now;
    this.hasPose = true;

    const alpha = isFresh ? 1 : 1 - Math.exp(-42 * Math.max(0, Math.min(0.1, dt)));
    for (let i = 0; i < 21; i++) {
      if (isFresh) this.smoothedPoints[i].copy(points[i]);
      else this.smoothedPoints[i].lerp(points[i], alpha);
    }

    const pts = this.smoothedPoints;
    const targetOpacity = clamp(0.45 + confidence * 0.5, 0.4, 0.95);
    this.opacity = isFresh ? targetOpacity : damp(this.opacity, targetOpacity, 14, dt);
    this.material.opacity = this.opacity;
    this.nailMaterial.opacity = Math.min(1, this.opacity + 0.04);

    const pinchGoal = this.feedbackVisible && this.pinchActive ? 1 : 0;
    this.pinchStrength = damp(this.pinchStrength, pinchGoal, 18, dt);
    this.material.emissiveIntensity = 0.1 + this.pinchStrength * 0.35;

    // Metric scale factor from wrist (0) -> middle MCP (9) in world space at HAND_DISTANCE.
    const palmLen = Math.max(0.04, pts[0].distanceTo(pts[9]));
    const rScale = clamp(palmLen / 0.44, 0.42, 1.05);

    // 1) Update 21 sculpted joint spheres
    for (let i = 0; i < 21; i++) {
      const m = this.joints[i];
      m.position.copy(pts[i]);
      m.scale.setScalar(JOINT_RADII[i] * rScale);
    }

    // 2) Update 16 anatomically tapered phalanges
    for (const seg of this.segments) {
      const pa = pts[seg.a];
      const pb = pts[seg.b];
      const len = pa.distanceTo(pb);
      if (len < 1e-5) {
        seg.mesh.visible = false;
        continue;
      }
      seg.mesh.visible = true;
      seg.mesh.position.addVectors(pa, pb).multiplyScalar(0.5);
      this.segDir.subVectors(pb, pa).normalize();
      this.segQuat.setFromUnitVectors(UP, this.segDir);
      seg.mesh.quaternion.copy(this.segQuat);
      const r = seg.ra * rScale;
      seg.mesh.scale.set(r, len, r);
    }

    // 3) Update sculpted deformable 3D palm
    this.updatePalm(pts, rScale);

    // 4) Update fingernails aligned to distal phalanx + palm dorsal normal
    this.updateNails(pts, rScale);

    // 5) Pinch glow
    if (this.feedbackVisible && this.pinchStrength > 0.02 && pinchPoint) {
      this.pinchPos.set(pinchPoint.x, pinchPoint.y, pinchPoint.z);
      this.glow.visible = true;
      this.glow.position.copy(this.pinchPos);
      this.glow.scale.setScalar(glowScale * (0.78 + this.pinchStrength * 0.45));
      this.glowMaterial.opacity = this.pinchStrength * 0.88 * this.opacity;
    } else {
      this.glow.visible = false;
    }
  }

  private updatePalm(pts: THREE.Vector3[], rScale: number): void {
    palmBasisInto(pts, this.livePalm);
    // Ensure palmNormal points consistently toward the dorsal/palmar thickness axis
    this.palmNormal.copy(this.livePalm.y);
    const halfThick = 0.0155 * rScale;
    const ring = [0, 1, 5, 9, 13, 17];
    const pos = this.palm.positions;

    this.palmCenter.set(0, 0, 0);
    for (let i = 0; i < 6; i++) {
      const p = pts[ring[i]];
      this.palmCenter.add(p);
      // Slight thickness taper at knuckles vs wrist
      const t = i === 0 ? halfThick * 1.18 : i === 1 ? halfThick * 1.08 : halfThick * 0.85;
      // Dorsal vertex (i)
      pos[i * 3] = p.x + this.palmNormal.x * t;
      pos[i * 3 + 1] = p.y + this.palmNormal.y * t;
      pos[i * 3 + 2] = p.z + this.palmNormal.z * t;
      // Palmar vertex (6 + i)
      pos[(6 + i) * 3] = p.x - this.palmNormal.x * t;
      pos[(6 + i) * 3 + 1] = p.y - this.palmNormal.y * t;
      pos[(6 + i) * 3 + 2] = p.z - this.palmNormal.z * t;
    }
    this.palmCenter.multiplyScalar(1 / 6);
    // Dorsal center arch (12)
    pos[12 * 3] = this.palmCenter.x + this.palmNormal.x * halfThick * 1.15;
    pos[12 * 3 + 1] = this.palmCenter.y + this.palmNormal.y * halfThick * 1.15;
    pos[12 * 3 + 2] = this.palmCenter.z + this.palmNormal.z * halfThick * 1.15;
    // Palmar center hollow (13)
    pos[13 * 3] = this.palmCenter.x - this.palmNormal.x * halfThick * 0.85;
    pos[13 * 3 + 1] = this.palmCenter.y - this.palmNormal.y * halfThick * 0.85;
    pos[13 * 3 + 2] = this.palmCenter.z - this.palmNormal.z * halfThick * 0.85;

    const attr = this.palm.geo.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.palm.geo.computeVertexNormals();
  }

  private updateNails(pts: THREE.Vector3[], rScale: number): void {
    // Orient dorsal normal away from palm center toward the back of the hand.
    // Note: in MediaPipe, for mirrored right hand, livePalm.y may point palmar or dorsal;
    // we orient the nail perpendicular to each distal bone on the side facing away from the thumb/palm.
    for (let f = 0; f < 5; f++) {
      const tip = pts[FINGERTIP_INDICES[f]];
      const prev = pts[FINGERTIP_PREV[f]];
      const nail = this.nails[f];
      this.segDir.subVectors(tip, prev);
      const len = this.segDir.length();
      if (len < 1e-5) {
        nail.visible = false;
        continue;
      }
      nail.visible = true;
      this.segDir.multiplyScalar(1 / len);

      const r = FINGERTIP_RADII[f] * rScale;
      // Offset slightly back from the very tip and toward the dorsal side
      this.nailUp.copy(this.segDir);
      this.nailRight.crossVectors(this.nailUp, this.livePalm.y);
      if (this.nailRight.lengthSq() < 1e-6) {
        this.nailRight.crossVectors(this.nailUp, UP);
      }
      this.nailRight.normalize();
      this.palmNormal.crossVectors(this.nailRight, this.nailUp).normalize();

      this.nailMatrix.makeBasis(this.nailRight, this.nailUp, this.palmNormal);
      nail.quaternion.setFromRotationMatrix(this.nailMatrix);
      nail.position
        .copy(tip)
        .addScaledVector(this.segDir, -r * 0.45)
        .addScaledVector(this.palmNormal, r * 0.72);
      nail.scale.setScalar(r * 0.72);
    }
  }

  dispose(): void {
    this.jointGeo.dispose();
    this.phalanxGeo.dispose();
    this.nailGeo.dispose();
    this.palm.geo.dispose();
    this.material.dispose();
    this.nailMaterial.dispose();
    this.glowMaterial.dispose();
    this.glowMap.dispose();
  }
}
