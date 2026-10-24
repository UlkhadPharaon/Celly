# Hand pose replay fixtures

Deterministic 21-point MediaPipe-style landmark snapshots for the hand-retargeting regression
suite. They are generated from `src/core/handPoses.ts` — not recorded from a camera — and are
therefore stable across machines.

Each file is:

```json
{
  "version": 1,
  "name": "pinch",
  "side": "right",
  "viewport": { "width": 1280, "height": 800 },
  "generatedBy": "src/core/handPoses.ts",
  "frames": [PoseData]
}
```

`PoseData.landmarks` are pre-mirror, pre-reach normalized image coordinates (what the tracker
publishes). `PoseData.world` is wrist-centred in metres with y up and z toward the camera.
`pinching` marks the two grasp poses (`pinch`, `ok`).

Sequences: `wiggle`, `wrist-rotation-slow`, and `fast-movement` contain 13 frames each. All other
files contain one frame. Replay one frame with `window.__celly.injectPoseData(frame)` in the
browser harness, or convert `world` to the rig's local convention for offline solver tests.

Regenerate:

```powershell
npm run dev -- --port 5173
node scripts/write-hand-fixtures.mjs
```
