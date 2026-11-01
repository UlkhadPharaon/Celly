import * as THREE from 'three';
import type { HandFrame, HandSide, Settings } from '../types';
import { clamp } from '../core/math';
import { mapNormalized } from '../gestures/cursor';
import { SkeletonHand } from './skeletonHand';

/** Distance from the camera along its view ray. The hand stays in front of the cell. */
const HAND_DISTANCE = 4.35;
/** MediaPipe world landmarks are metric; this is the on-screen size of a reference hand. */
const PX_PER_METRE = 1.05;
const REFERENCE_HAND_SCALE = 0.094;
const DEPTH_GAIN = 18;
const NDC = new THREE.Vector3();
const DIR = new THREE.Vector3();
const FORWARD = new THREE.Vector3();
const PINCH = new THREE.Vector3();
const LANDMARK = new THREE.Vector3();
const WORLD_POINTS: THREE.Vector3[] = Array.from({ length: 21 }, () => new THREE.Vector3());

/**
 * Places the two tracked hands in front of the cell as light skeletons.
 *
 * Every joint is placed on the camera ray through its mapped screen position, so the skeleton is
 * an exact screen-space drawing of the tracked hand and landmark 8 lands on the pointer. World
 * landmarks supply the *shape* (metric, stable under camera distance); the normalised landmarks
 * supply only the pointer and the screen placement. That split avoids the old mesh's palm-basis
 * retargeting while still letting fingers curl and the wrist rotate.
 */
export class HandLayer {
  readonly group = new THREE.Group();
  private readonly hands = new Map<HandSide, SkeletonHand>();
  private readonly map = { width: 0, height: 0, mirrorX: true, mirrorY: false };

  constructor() {
    for (const side of ['left', 'right'] as const) {
      const hand = new SkeletonHand(side);
      hand.container.visible = false;
      this.hands.set(side, hand);
      this.group.add(hand.container);
    }
  }

  update(
    frames: HandFrame[],
    settings: Settings,
    dt: number,
    camera: THREE.PerspectiveCamera,
    pixelRatio = 1
  ): void {
    camera.updateMatrixWorld();
    const map = this.map;
    map.width = window.innerWidth;
    map.height = window.innerHeight;
    map.mirrorX = settings.mirrorX;
    map.mirrorY = settings.mirrorY;
    camera.getWorldDirection(FORWARD);
    const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);

    for (const side of ['left', 'right'] as const) {
      const hand = this.hands.get(side);
      if (!hand) continue;
      const frame = frames.find((f) => f.side === side && f.present);

      if (!frame) {
        if (hand.container.visible) hand.container.visible = false;
        continue;
      }

      hand.container.visible = true;
      hand.setResolution(map.width, map.height, pixelRatio);

      // The apparent hand size follows the tracked hand's metric span, but bounded: a hand very
      // close to the lens should not become a giant skeleton, and one at the back of the room
      // should not vanish. Using the metric span (not the screen span) keeps the overlay the same
      // size whichever way the camera is angled.
      const handScale = frame.handScale > 1e-4 ? frame.handScale : REFERENCE_HAND_SCALE;
      const pxPerMetre =
        PX_PER_METRE * map.height * clamp(handScale / REFERENCE_HAND_SCALE, 0.7, 1.4);
      const hasWorld =
        frame.worldMetric !== false &&
        frame.world.length === 21 &&
        frame.handScale > 0.005 &&
        worldIsFinite(frame.world);
      const indexWorld = hasWorld ? frame.world[8] : null;

      let thumbScreenX = frame.cursor.x;
      let thumbScreenY = frame.cursor.y;
      let indexScreenX = frame.cursor.x;
      let indexScreenY = frame.cursor.y;
      let thumbDistance = HAND_DISTANCE;
      let indexDistance = HAND_DISTANCE;

      for (let i = 0; i < 21; i++) {
        let dx = 0;
        let dy = 0;
        let dz = 0;
        let screenX: number;
        let screenY: number;
        if (hasWorld && indexWorld) {
          // App publishes world landmarks in display orientation (x right, y up), already
          // mirrored to match the pointer mapping, so the deltas need no extra flip.
          const point = frame.world[i];
          dx = point.x - indexWorld.x;
          dy = point.y - indexWorld.y;
          dz = point.z - indexWorld.z;
          screenX = frame.cursor.x + dx * pxPerMetre;
          screenY = frame.cursor.y - dy * pxPerMetre;
        } else {
          // No metric landmarks: use the normalized image positions directly. `mapNormalized`
          // applies the same mirror and reach mapping as the cursor, so the shape stays glued to
          // the pointer without a second scale factor.
          const mapped = mapNormalized(frame.landmarks[i], map);
          screenX = mapped.x;
          screenY = mapped.y;
        }

        const distance = clamp(HAND_DISTANCE - dz * DEPTH_GAIN, 3.2, 5.4);
        worldOnRay(camera, screenX / map.width, screenY / map.height, distance, WORLD_POINTS[i]);

        if (i === 4) {
          thumbScreenX = screenX;
          thumbScreenY = screenY;
          thumbDistance = distance;
        } else if (i === 8) {
          indexScreenX = screenX;
          indexScreenY = screenY;
          indexDistance = distance;
        }
      }

      const pinchWorld = worldOnRay(
        camera,
        (thumbScreenX + indexScreenX) / 2 / map.width,
        (thumbScreenY + indexScreenY) / 2 / map.height,
        (thumbDistance + indexDistance) / 2,
        PINCH
      );

      // A pinch glow is a fixed number of CSS pixels across, independent of camera distance.
      const opticalDepth = Math.max(0.2, HAND_DISTANCE * FORWARD.dot(DIR));
      const worldPerPixel = (2 * tanHalfFov * opticalDepth) / map.height;
      const glowScale = worldPerPixel * 46;

      hand.setFeedbackVisible(settings.showFeedback);
      hand.setPinchGlow(frame.pinching);
      hand.apply(WORLD_POINTS, pinchWorld ? { x: PINCH.x, y: PINCH.y, z: PINCH.z } : null, dt, frame.confidence, glowScale);
    }
  }

  resetCalibration(): void {
    for (const hand of this.hands.values()) hand.resetCalibration();
  }

  /** Test hook: the live container for a side (position, scale, visibility). */
  debugContainer(side: HandSide): { position: THREE.Vector3; scale: THREE.Vector3; quaternion: THREE.Quaternion } | null {
    const hand = this.hands.get(side);
    return hand
      ? {
          position: hand.container.position,
          scale: hand.container.scale,
          quaternion: hand.container.quaternion
        }
      : null;
  }

  debugHand(side: HandSide): Record<string, unknown> | null {
    return this.hands.get(side)?.debugState() ?? null;
  }

  /**
   * Test hook: the pinch glow projected into CSS pixels. The cursor rides the index fingertip;
   * this is the secondary contact point used by the gesture's travel budget.
   */
  debugPinch(side: HandSide, camera: THREE.PerspectiveCamera): { x: number; y: number } | null {
    const pinch = this.hands.get(side)?.pinchWorld(PINCH);
    if (!pinch) return null;
    return project(camera, pinch);
  }

  /** Test hook: a tracked skeleton joint projected into CSS pixels (8 = index fingertip). */
  debugLandmark(
    side: HandSide,
    camera: THREE.PerspectiveCamera,
    index: number
  ): { x: number; y: number } | null {
    const landmark = this.hands.get(side)?.landmarkWorld(LANDMARK, index);
    if (!landmark) return null;
    return project(camera, landmark);
  }

  dispose(): void {
    for (const hand of this.hands.values()) {
      this.group.remove(hand.container);
      hand.dispose();
    }
    this.hands.clear();
  }
}

function project(camera: THREE.PerspectiveCamera, point: THREE.Vector3): { x: number; y: number } {
  const p = NDC.copy(point).project(camera);
  return {
    x: (p.x * 0.5 + 0.5) * window.innerWidth,
    y: (0.5 - p.y * 0.5) * window.innerHeight
  };
}

function worldIsFinite(points: Array<{ x: number; y: number; z: number }>): boolean {
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false;
  }
  return true;
}

/**
 * World point on the camera ray through a screen fraction, at `distance` from the camera.
 * `u`/`v` are 0..1 in CSS pixels after the normalisation/mirror mapping.
 */
function worldOnRay(
  camera: THREE.PerspectiveCamera,
  u: number,
  v: number,
  distance: number,
  out: THREE.Vector3
): THREE.Vector3 {
  NDC.set(u * 2 - 1, -(v * 2 - 1), 0.5).unproject(camera);
  DIR.copy(NDC).sub(camera.position).normalize();
  return out.copy(camera.position).addScaledVector(DIR, distance);
}
