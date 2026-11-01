# Credits & Licenses

Every third-party asset and dependency, with its licence. Rule for this repo: **anything that ships
a binary, model or font needs a row here before it merges.**

## Bundled runtime assets

| Asset | Author | Source | License | Where |
|---|---|---|---|---|
| MediaPipe vision WASM runtime (`vision_wasm_*.{js,wasm}`) | Google LLC | npm package `@mediapipe/tasks-vision@1.1.0`, copied to `public/mediapipe-wasm/` by `scripts/fetch-assets.mjs` | Apache-2.0 | local, unmodified |
| `hand_landmarker.task` model (7.8 MB) | Google LLC | <https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task> (model card: <https://aka.ms/hand_landmarker_model>) | Apache-2.0 | `public/models/` (committed) |
| Space Grotesk (latin, 400/500/700) | Florian Karsten | `@fontsource/space-grotesk@5` | SIL OFL 1.1 | bundled by Vite |
| Inter (latin, 400/500/600/700) | Rasmus Andersson | `@fontsource/inter@5` | SIL OFL 1.1 | bundled by Vite |

## Code dependencies (npm)

| Package | Version | License |
|---|---|---|
| three | 0.186.1 | MIT |
| @mediapipe/tasks-vision | 1.1.0 | Apache-2.0 |
| @fontsource/inter | 5.2.5 | OFL-1.1 |
| @fontsource/space-grotesk | 5.2.5 | OFL-1.1 |
| vite | 8.3.4 | MIT |
| typescript | 6.0.3 | Apache-2.0 |
| vitest | 5.0.4 | MIT |
| @playwright/test | 1.64.0 | Apache-2.0 |
| @types/three | 0.186.0 | MIT |
| eslint | 9.x | MIT |
| typescript-eslint | 8.x | MIT |
| prettier | 3.x | MIT |

Full transitive licence texts live in `node_modules/` and in `package-lock.json`.

## Procedural / original content

- **All cell and UI 3D geometry** (membrane, organelles, nucleus, cytoskeleton, knowledge nodes and
  edges, environment, particles, textures) is generated at runtime by code in this repository. No
  third-party cell model is shipped or loaded.
- **Why not NIH 3D / marketplace models:** evaluated in [`docs/RESEARCH.md`](docs/RESEARCH.md) §3 —
  per-item licences were unclear or non-commercial, and print-oriented models are fused shells
  without separable named parts, which the isolate/select interactions require.
- **Metadata texts** (organelle summaries, functions, structures, fun facts, knowledge nodes,
  questions, flashcards — EN + FR) are original summaries written for this project, checked against
  open biology references (LibreTexts Biology, CC-BY; OpenStax Biology 2e, CC-BY) for accuracy.
- **Hand skeleton** — the 21-joint / 21-bone overlay, geometry, shaders and placement code are
  original to this repository. The visual approach was inspired by the Cellab reference; no Cellab
  code or assets are copied.
- **Icons** are hand-authored inline SVG (`src/ui/dom.ts`). No icon font.
- **Screenshots** in `docs/screenshots/` are renders of this software captured with Playwright.

## Writing

- **“From RGB camera to 3D interaction — how controller-free XR could transform learning”**,
  Ulkhad Pharaon — [Medium](https://medium.com/@ulrichtapsoba2009/from-rgb-camera-to-3d-interaction-how-controller-free-xr-could-transform-learning-d920d92cf5ba).
  The companion learn article for this project.

## Notes

- The MediaPipe model and WASM are redistributed unmodified, satisfying Apache-2.0 attribution; the
  NOTICE and LICENSE texts ship inside `node_modules/@mediapipe/tasks-vision/`.
- No hand mesh, rig or hand texture ships with v0.2. The skeleton is generated from MediaPipe
  landmarks at runtime; older `hands_*.glb` files are removed by `scripts/fetch-assets.mjs`.
- No audio assets are used in v0.2.
- This project's own code is MIT-licensed (see [`LICENSE`](LICENSE)), © 2026 Ulkhad Pharaon and
  Celly contributors.
