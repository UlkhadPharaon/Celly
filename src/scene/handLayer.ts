import * as THREE from 'three';
import type { HandFrame, HandSide, Settings } from '../types';
import { clamp, damp } from '../core/math';
import { mapNormalized } from '../gestures/cursor';
import { loadHands, type DrivenHand } from './handRig';

/** Distance from the camera along its view ray. The hand stays in front of the cell. */
const HAND_DISTANCE = 4.35;
/** Reference distance the visual scale constants were tuned at. */
const HAND_REFERENCE_DISTANCE = 5.05;
const RAY = new THREE.Vector3();
const DIR = new THREE.Vector3();
const NDC = new THREE.Vector3();

/**
 * Places the two tracked hands in front of the cell.
 *
 * The container is the wrist root: its origin is landmark 0 and its quaternion is the palm
 * orientation. Nothing is anchored to the moving thumb/index midpoint. That distinction is what
 * keeps the virtual wrist glued to the tracked wrist when the palm turns.
 */
export class HandLayer {
  readonly group = new THREE.Group();
  private readonly hands = new Map<HandSide, DrivenHand>();
  private ready = false;
  private rigged = false;

  async init(forceProcedural = false): Promise<void> {
    try {
      const loaded = await loadHands(forceProcedural);
      this.hands.set('left', loaded.left);
      this.hands.set('right', loaded.right);
      this.rigged = loaded.rigged;
      for (const hand of this.hands.values()) {
        hand.container.visible = false;
        hand.container.position.set(0, 0, HAND_DISTANCE);
        hand.container.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh || (obj as THREE.Sprite).isSprite) obj.renderOrder = 2;
        });
        this.group.add(hand.container);
      }
      this.ready = true;
    } catch (err) {
      console.warn('[celly] hand layer failed to initialise:', err);
    }
  }

  get usingRiggedMeshes(): boolean {
    return this.rigged;
  }

  update(frames: HandFrame[], settings: Settings, dt: number, camera: THREE.PerspectiveCamera): void {
    if (!this.ready) return;
    camera.updateMatrixWorld();
    const map = {
      width: window.innerWidth,
      height: window.innerHeight,
      mirrorX: settings.mirrorX,
      mirrorY: settings.mirrorY
    };

    for (const side of ['left', 'right'] as const) {
      const hand = this.hands.get(side);
      if (!hand) continue;
      const frame = frames.find((f) => f.side === side && f.present);

      if (!frame) {
        if (hand.container.visible) hand.container.visible = false;
        continue;
      }

      hand.container.visible = true;

      // 1) Position: map the *wrist* (landmark 0) to the screen and unproject that ray at a
      // fixed camera distance. The projected wrist is therefore exactly the tracked wrist.
      const wrist = mapNormalized(frame.landmarks[0], map);
      const target = worldOnRay(camera, wrist.x / map.width, wrist.y / map.height, HAND_DISTANCE, RAY);
      // Position is not damped: the landmark filter has already removed camera noise, and a
      // first-order lag here would make the wrist trail the tracked hand by several percent of
      // screen height during fast movement. Orientation is the only thing that needs smoothing.
      hand.container.position.copy(target);

      // 2) Scale: use the image-space wrist → middle-MCP span, which shrinks as the hand moves
      // away from the camera. Scaling happens around the container origin (the wrist), so it
      // never pulls the pivot away from the tracked wrist.
      const span = frame.handSpan > 1e-5 ? frame.handSpan : 0.1;
      const cue = clamp(span / 0.1, 0.55, 1.55);
      const targetScale = 0.82 * cue * (HAND_DISTANCE / HAND_REFERENCE_DISTANCE);
      const s = damp(hand.container.scale.x, targetScale, 10, dt);
      hand.container.scale.setScalar(s);

      hand.setFeedbackVisible(settings.showFeedback);
      hand.setPinchGlow(frame.pinching);

      // Orientation and fingers are computed from the *unmirrored* world landmarks. Mirroring
      // is a screen-position transform; reflecting the orientation data would make the rotation
      // basis left-handed and introduce flips. Separate left/right meshes provide the anatomy.
      hand.apply(frame.world, dt, frame.confidence);
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
    return this.hands.get(side)?.debugState?.() ?? null;
  }

  dispose(): void {
    for (const hand of this.hands.values()) {
      this.group.remove(hand.container);
      hand.dispose();
    }
    this.hands.clear();
    this.ready = false;
  }
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
