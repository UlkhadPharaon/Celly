import * as THREE from 'three';
import type { HandSide, Vec3 } from '../types';
import { clamp, damp } from '../core/math';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { glowTexture } from './textures';

/**
 * MediaPipe hand topology. Besides the five finger chains, four palm links are explicit:
 * 0→17 closes the wrist to the pinky, and 5→9, 9→13, 13→17 join the knuckles. Without them the
 * palm reads as five separate sticks instead of a hand.
 */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

const COLORS: Record<HandSide, string> = {
  left: '#7ee0c3',
  right: '#ffd166'
};

const TIP = new THREE.Color('#ffffff');
const PINCH_HOT = new THREE.Color('#fff3c4');
const GLOW = new THREE.Color('#ff9f45');

const POINT_SIZES = new Float32Array(21).fill(7);
for (const index of [4, 8, 12, 16, 20]) POINT_SIZES[index] = 8.5;
POINT_SIZES[8] = 11;

/**
 * Lightweight Cellab-style hand: 21 rounded joints and 21 bone lines, drawn on top of the cell.
 *
 * The layer above hands it *screen positions* already aligned with the pointer, then this class
 * places every joint on the camera ray through that position. Consequently the index tip projects
 * exactly under the cursor at any viewport size, field of view or camera distance, while the 3D
 * positions still give the points a little depth for the bloom pass.
 */
export class SkeletonHand {
  readonly container = new THREE.Group();
  readonly side: HandSide;

  private readonly joints: THREE.Points;
  private readonly bones: LineSegments2;
  private readonly boneUnderlay: LineSegments2;
  private readonly glow: THREE.Sprite;
  private readonly pointPositions = new Float32Array(21 * 3);
  private readonly linePositions = new Float32Array(HAND_CONNECTIONS.length * 2 * 3);
  private readonly colors = new Float32Array(21 * 3);
  private readonly pointMaterial: THREE.ShaderMaterial;
  private readonly boneMaterial: LineMaterial;
  private readonly underlayMaterial: LineMaterial;
  private readonly boneGeometry: LineSegmentsGeometry;
  private readonly glowMaterial: THREE.SpriteMaterial;
  private readonly glowMap: THREE.Texture;

  private feedbackVisible = true;
  private pinchActive = false;
  private pinchStrength = 0;
  private opacity = 1;
  private hasPose = false;
  private hot = false;
  private color: THREE.Color;
  private indexTip = new THREE.Vector3();
  private pinchPoint = new THREE.Vector3();
  private lastApplyMs = 0;

  constructor(side: HandSide) {
    this.side = side;
    this.color = new THREE.Color(COLORS[side]);
    this.container.name = `hand-skeleton-${side}`;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pointPositions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(POINT_SIZES, 1));
    this.pointMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: 1 },
        uOpacity: { value: 1 }
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uPixelRatio;
        varying vec3 vColor;

        void main() {
          vColor = aColor;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          // Constant CSS-pixel size: the skeleton is a UI overlay, not a world object that
          // should shrink when the user moves their hand nearer to the camera.
          gl_PointSize = aSize * uPixelRatio;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;

        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float r = length(p);
          if (r > 0.5) discard;
          // Dark rim + coloured core. The cell membrane and the bloom pass are both bright, so a
          // plain soft dot disappeared against them; the rim keeps every joint readable.
          float edge = smoothstep(0.5, 0.36, r);
          float core = smoothstep(0.34, 0.12, r);
          vec3 col = mix(vec3(0.008, 0.025, 0.04), vColor, 0.35 + 0.65 * core);
          gl_FragColor = vec4(col, edge * uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    this.joints = new THREE.Points(geometry, this.pointMaterial);
    this.joints.frustumCulled = false;
    this.joints.renderOrder = 6;

    this.boneGeometry = new LineSegmentsGeometry();
    this.boneGeometry.setPositions(Array.from(this.linePositions));
    this.underlayMaterial = new LineMaterial({
      color: new THREE.Color('#03080f'),
      linewidth: 4.5,
      worldUnits: false,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false
    });
    this.boneUnderlay = new LineSegments2(this.boneGeometry, this.underlayMaterial);
    this.boneUnderlay.frustumCulled = false;
    this.boneUnderlay.renderOrder = 4;

    this.boneMaterial = new LineMaterial({
      color: new THREE.Color(COLORS[side]),
      linewidth: 2.2,
      worldUnits: false,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false
    });
    this.bones = new LineSegments2(this.boneGeometry, this.boneMaterial);
    this.bones.frustumCulled = false;
    this.bones.renderOrder = 5;

    this.glowMap = glowTexture(64);
    this.glowMaterial = new THREE.SpriteMaterial({
      map: this.glowMap,
      color: new THREE.Color(GLOW),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false
    });
    this.glow = new THREE.Sprite(this.glowMaterial);
    this.glow.scale.setScalar(0.2);
    this.glow.renderOrder = 7;
    this.glow.visible = false;

    this.container.add(this.boneUnderlay, this.bones, this.joints, this.glow);
    this.paint(this.hot);
  }

  /** CSS-pixel resolution and device pixel ratio for the line/point shaders. */
  setResolution(width: number, height: number, pixelRatio = 1): void {
    this.boneMaterial.resolution.set(width, height);
    this.underlayMaterial.resolution.set(width, height);
    this.pointMaterial.uniforms.uPixelRatio.value = Math.min(3, Math.max(1, pixelRatio));
  }

  setFeedbackVisible(visible: boolean): void {
    this.feedbackVisible = visible;
    this.syncVisibility();
  }

  setPinchGlow(active: boolean): void {
    this.pinchActive = active;
    this.syncVisibility();
  }

  setOpacity(value: number): void {
    this.opacity = clamp(value, 0, 1);
    this.pointMaterial.uniforms.uOpacity.value = this.opacity;
    this.boneMaterial.opacity = 0.95 * this.opacity;
    this.underlayMaterial.opacity = 0.55 * this.opacity;
  }

  /**
   * @param world absolute world positions for the 21 joints, wrist first
   * @param pinch absolute world position of the thumb/index contact, if any
   * @param glowScale world-units-per-pixel × desired glow diameter
   */
  apply(world: Vec3[], pinch: Vec3 | null, dt: number, confidence = 1, glowScale = 0.2): void {
    if (world.length < 21) return;
    const start = performance.now();
    const wrist = world[0];
    this.container.position.set(wrist.x, wrist.y, wrist.z);

    const heat = this.pinchActive || (pinch !== null && this.pinchStrength > 0.05);
    if (heat !== this.hot) {
      this.hot = heat;
      this.paint(heat);
    }

    for (let i = 0; i < 21; i++) {
      const point = world[i];
      this.pointPositions[i * 3] = point.x - wrist.x;
      this.pointPositions[i * 3 + 1] = point.y - wrist.y;
      this.pointPositions[i * 3 + 2] = point.z - wrist.z;
    }

    for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
      const [a, b] = HAND_CONNECTIONS[i];
      const o = i * 6;
      this.linePositions[o] = this.pointPositions[a * 3];
      this.linePositions[o + 1] = this.pointPositions[a * 3 + 1];
      this.linePositions[o + 2] = this.pointPositions[a * 3 + 2];
      this.linePositions[o + 3] = this.pointPositions[b * 3];
      this.linePositions[o + 4] = this.pointPositions[b * 3 + 1];
      this.linePositions[o + 5] = this.pointPositions[b * 3 + 2];
    }

    const pointGeometry = this.joints.geometry as THREE.BufferGeometry;
    (pointGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.boneGeometry.setPositions(this.linePositions);

    this.indexTip.set(
      this.pointPositions[8 * 3],
      this.pointPositions[8 * 3 + 1],
      this.pointPositions[8 * 3 + 2]
    ).add(this.container.position);

    if (pinch) {
      this.pinchPoint.copy(pinch);
      this.glow.position.copy(pinch).sub(this.container.position);
      this.glow.visible = this.feedbackVisible;
    }

    const target = this.pinchActive && pinch ? 1 : 0;
    this.pinchStrength = damp(this.pinchStrength, target, 14, dt);
    this.glowMaterial.opacity = this.pinchStrength * 0.95 * this.opacity;
    this.glow.scale.setScalar(Math.max(0.05, glowScale));
    if (this.pinchStrength < 0.02) this.glow.visible = false;
    else if (this.feedbackVisible && pinch) this.glow.visible = true;

    const confidenceAlpha = 0.42 + 0.58 * clamp(confidence, 0, 1);
    this.pointMaterial.uniforms.uOpacity.value = this.opacity * confidenceAlpha;
    this.boneMaterial.opacity = 0.95 * this.opacity * confidenceAlpha;
    this.underlayMaterial.opacity = 0.55 * this.opacity * confidenceAlpha;
    this.hasPose = true;
    this.lastApplyMs = performance.now() - start;
  }

  landmarkWorld(out: THREE.Vector3, index: number): THREE.Vector3 | null {
    if (!this.hasPose || index < 0 || index > 20) return null;
    return out
      .set(
        this.pointPositions[index * 3],
        this.pointPositions[index * 3 + 1],
        this.pointPositions[index * 3 + 2]
      )
      .add(this.container.position);
  }

  pinchWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.hasPose) return null;
    return out.copy(this.pinchPoint);
  }

  resetCalibration(): void {
    this.pinchStrength = 0;
    this.glowMaterial.opacity = 0;
    this.glow.visible = false;
  }

  debugState(): Record<string, unknown> {
    return {
      source: 'skeleton',
      side: this.side,
      points: 21,
      segments: HAND_CONNECTIONS.length,
      visible: this.container.visible && this.joints.visible,
      feedbackVisible: this.feedbackVisible,
      pinching: this.pinchActive,
      pinchGlow: Number(this.pinchStrength.toFixed(3)),
      applyMs: Number(this.lastApplyMs.toFixed(3)),
      indexTip: [this.indexTip.x, this.indexTip.y, this.indexTip.z],
      pinch: [this.pinchPoint.x, this.pinchPoint.y, this.pinchPoint.z]
    };
  }

  dispose(): void {
    this.joints.geometry.dispose();
    this.pointMaterial.dispose();
    this.boneGeometry.dispose();
    this.boneMaterial.dispose();
    this.underlayMaterial.dispose();
    this.glowMaterial.dispose();
    this.glowMap.dispose();
    this.container.clear();
  }

  private syncVisibility(): void {
    this.joints.visible = this.feedbackVisible;
    this.bones.visible = this.feedbackVisible;
    this.boneUnderlay.visible = this.feedbackVisible;
    this.glow.visible = this.feedbackVisible && this.pinchActive && this.pinchStrength > 0.02;
  }

  /** Base colour plus white index tip, amber fingertips while pinching. */
  private paint(hot: boolean): void {
    for (let i = 0; i < 21; i++) {
      const color = hot && (i === 4 || i === 8) ? PINCH_HOT : i === 8 ? TIP : this.color;
      this.colors[i * 3] = color.r;
      this.colors[i * 3 + 1] = color.g;
      this.colors[i * 3 + 2] = color.b;
    }
    const attribute = this.joints.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    attribute.needsUpdate = true;
  }
}
