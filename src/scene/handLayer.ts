import * as THREE from 'three';
import type { HandFrame, HandSide, Settings, Vec3 } from '../types';
import { clamp, damp } from '../core/math';
import { mapNormalized } from '../gestures/cursor';
import { loadHands, type DrivenHand } from './handRig';

const TARGET_Z = 1.95;
const PINCH = new THREE.Vector3();
const NDC = new THREE.Vector3();

/**
 * Places the two tracked hands in front of the cell. The wrist drives position,
 * the retargeted skeleton drives orientation, and everything is exponentially
 * smoothed so MediaPipe jitter never reaches the mesh.
 */
export class HandLayer {  readonly group = new THREE.Group();
  private readonly hands = new Map<HandSide, DrivenHand>();
  private ready = false;
  private rigged = false;

  async init(): Promise<void> {
    try {
      const loaded = await loadHands();
      this.hands.set('left', loaded.left);
      this.hands.set('right', loaded.right);
      this.rigged = loaded.rigged;
      for (const hand of this.hands.values()) {
        hand.container.visible = false;
        hand.container.position.set(0, 0, TARGET_Z);
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
      const wrist = mapNormalized(frame.landmarks[0], map);
      const nx = wrist.x / map.width;
      const ny = wrist.y / map.height;
      const targetX = clamp((nx - 0.5) * 5.9, -3.1, 3.1);
      const targetY = clamp((0.5 - ny) * 3.7 - 0.3, -1.45, 1.75);
      const d = hand.container.position;
      d.x = damp(d.x, targetX, 13, dt);
      d.y = damp(d.y, targetY, 13, dt);
      d.z = damp(d.z, TARGET_Z, 10, dt);

      const sizeCue = clamp(frame.handScale / 0.088, 0.6, 1.45);
      // ~0.7 unit tall at the lab camera: a hand reads as ~17% of the viewport, big enough to
      // feel present without covering the cell it is pointing at.
      const targetScale = 0.7 * (0.9 + 0.14 * sizeCue);
      const s = damp(hand.container.scale.x, targetScale, 8, dt);
      hand.container.scale.setScalar(s);

      hand.setFeedbackVisible(settings.showFeedback);
      hand.setPinchGlow(frame.pinching);
      hand.apply(mirrorWorld(frame.world, settings), dt);

      // Anchor by the pinch point, not the wrist: the fingertips have to meet at the cursor or
      // the user pinches one organelle while the hand floats next to it. The correction is
      // applied after the wrist damping, so it is exact and does not lag behind the cursor.
      const pinch = hand.pinchWorld(PINCH);
      if (pinch) {
        camera.updateMatrixWorld();
        NDC.copy(pinch).project(camera);
        const px = (NDC.x * 0.5 + 0.5) * map.width;
        const py = (0.5 - NDC.y * 0.5) * map.height;
        const depth = camera.position.distanceTo(pinch);
        const worldPerPx = (2 * Math.tan((camera.fov * Math.PI) / 360) * depth) / map.height;
        d.x += (frame.cursor.x - px) * worldPerPx;
        d.y -= (frame.cursor.y - py) * worldPerPx;
      }
    }
  }

  resetCalibration(): void {
    for (const hand of this.hands.values()) hand.resetCalibration();
  }

  /** Test hook: the live container for a side (position, scale, visibility). */
  debugContainer(side: HandSide): { position: THREE.Vector3; scale: THREE.Vector3 } | null {
    const hand = this.hands.get(side);
    return hand ? { position: hand.container.position, scale: hand.container.scale } : null;
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
 * Mirror mode is a display transform, not an anatomical one (DECISIONS D-16): flip the
 * landmark space so the 3D hand travels the same way as the cursor and the webcam preview.
 */
function mirrorWorld(world: Vec3[], settings: Settings): Vec3[] {
  if (!settings.mirrorX && !settings.mirrorY) return world;
  return world.map((p) => ({
    x: settings.mirrorX ? -p.x : p.x,
    y: settings.mirrorY ? -p.y : p.y,
    z: p.z
  }));
}
