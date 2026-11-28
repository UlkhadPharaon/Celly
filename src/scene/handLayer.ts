import * as THREE from 'three';
import type { HandFrame, HandSide, Settings } from '../types';
import { clamp } from '../core/math';
import { mapNormalized } from '../gestures/cursor';
import { RealHand } from './realHand';

/** Distance from the camera along its view ray. The hand stays in front of the cell. */
const HAND_DISTANCE = 4.35;
const DEPTH_GAIN = 18;
/** Sleek display scale around the index fingertip so the 3D hand never feels oversized. */
const HAND_DISPLAY_SCALE = 0.72;
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
  private readonly hands = new Map<HandSide, RealHand>();
  private readonly map = { width: 0, height: 0, mirrorX: true, mirrorY: false };

  constructor() {
    for (const side of ['left', 'right'] as const) {
      const hand = new RealHand(side);
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

    // The 3D mesh uses the SAME mirror mapping as the cursor and the (CSS-mirrored) webcam
    // preview, so a hand's mesh, its pointer and its preview skeleton all sit on one side. A
    // separate unmirrored map put the left hand's mesh on the right, split from its cursor.
    for (const side of ['left', 'right'] as const) {
      const hand = this.hands.get(side);
      if (!hand) continue;
      const frame = frames.find((f) => f.side === side && f.present);

      if (!frame) {
        if (hand.container.visible) hand.container.visible = false;
        continue;
      }

      hand.container.visible = true;
      hand.setMirrored(settings.mirrorX);
      hand.setResolution(map.width, map.height, pixelRatio);

      const hasWorld =
        frame.worldMetric !== false &&
        frame.world.length === 21 &&
        frame.handScale > 0.005 &&
        worldIsFinite(frame.world);
      const wristWorld = hasWorld ? frame.world[0] : null;

      let thumbScreenX = frame.cursor.x;
      let thumbScreenY = frame.cursor.y;
      let indexScreenX = frame.cursor.x;
      let indexScreenY = frame.cursor.y;
      let thumbDistance = HAND_DISTANCE;
      let indexDistance = HAND_DISTANCE;

      // Map landmarks through the SAME mirrored `map` the cursor uses, so the 3D mesh sits on the
      // same side as the pointer and the preview skeleton. The anchor (center of scaling) is the
      // index fingertip mapped through that same map so the hand fans out from its true position.
      const anchorMapped = mapNormalized(frame.landmarks[8], map);
      const anchorX = anchorMapped.x;
      const anchorY = anchorMapped.y;

      for (let i = 0; i < 21; i++) {
        // Normalized image landmarks mapped through the mirrored `map` for 3D placement. Metric
        // world Z provides realistic 3D depth relative to the wrist.
        const mapped = mapNormalized(frame.landmarks[i], map);
        const screenX = anchorX + (mapped.x - anchorX) * HAND_DISPLAY_SCALE;
        const screenY = anchorY + (mapped.y - anchorY) * HAND_DISPLAY_SCALE;
        const dz = hasWorld && wristWorld ? frame.world[i].z - wristWorld.z : 0;

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
