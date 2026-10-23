# Asset Inventory — Celly v0.2

Date: 2026-10-19 · Working folder: `D:\TKS\BUILD\Celly`

Full recursive sweep of `D:\TKS\BUILD` (Celly, Cellab, LEARN) before any code was written.

## 1. What exists

### 1.1 3D hand assets — **excellent, use them**

| File | Size | Contents | Verdict |
|---|---|---|---|
| `hands_rigged.glb` | 1.25 MB | 2 skinned meshes, 2 armatures (`Armature_Hand_L`, `Armature_Hand_R`), **21 joints each**, no textures | **PRIMARY** — clean, light, opaque |
| `hands_holo.glb` | 3.28 MB | Same rig + embedded `holo_L`/`holo_R` PNG textures | Optional alternate skin |
| `hands_ulkhad.glb` | 4.24 MB | Same rig + `holo2_L`/`holo2_R` textures | Optional alternate skin |
| `3d models/Hands/hand ulkhad rigging.blend` | 1.69 MB | Blender source of the rig | Source of record |
| `3d models/Hands/Hands  3DMesh.fbx` | 15.2 MB | FBX master mesh | Not needed at runtime |
| `3d models/Hands/{left,right} hand.png`, `Hand mesh reference .png` | — | Reference renders | Reference only |

**Critical finding:** both hands are already separated and the armature bones are named
`00_WRIST, 01_THUMB_CMC … 20_PINKY_TIP` — i.e. **the names encode the exact MediaPipe
landmark index**. The bone ↔ landmark map is therefore 1:1 and needs no auto-detection.
The existing prototype `Handtracking systems/Handtracking systems/app.js` already proves
retargeting works on this exact GLB (hand-local-frame method).

### 1.2 Cell assets — **none exist**

`3d models/Cell/` contains only reference **images**:

- `Colorful 3D Animal Cell Cutaway-2.png`, `Labeled 3D Animal Cell Diagram-1.png`
- `differents parts/` — 6 reference JPGs (nucleus, ER ×2, Golgi, mitochondrion, centrioles)

No `.glb`, `.gltf`, `.obj`, `.fbx` or `.blend` for a cell. **→ Procedural cell it is.**
Blender 5.2 and 4.3 are installed (`C:\Program Files\Blender Foundation`) if an export is
ever wanted, but runtime generation is cheaper and gives per-organelle transforms for free.

### 1.3 Tracking runtime — **already vendored locally**

| File | Size | License |
|---|---|---|
| `public/mediapipe-wasm/vision_wasm_internal.{js,wasm}` | 13.3 MB | Apache-2.0 |
| `public/mediapipe-wasm/vision_wasm_nosimd_internal.{js,wasm}` | 12.5 MB | Apache-2.0 |
| `public/models/hand_landmarker.task` | 7.8 MB | Apache-2.0 |

`scripts/fetch-assets.mjs` restores the wasm on `npm install`; the `.task` model is committed.
Fully offline-capable after first load.

### 1.4 Prior versions in the tree

| Version | Location | Status | What to reuse |
|---|---|---|---|
| **Cellab v1** | `D:\TKS\BUILD\Cellab\cell-lab.html` | Shipped, live at cellab.vercel.app | Organelle copy (definition/function/memory tip), quiz-clue phrasing, interaction model, oil-on-water UI restraint |
| **Celly v0.1 (Phase 1–2)** | `D:\TKS\BUILD\Celly\src\` | Scaffold only — 3D cells + lab, no tracking/UI | `cell/shapes.ts` geometry factories, `organelles.json` bilingual metadata, `cells.json` osmosis params, `util/math.ts` seeded RNG |
| **Hand Remote 3D** | `Celly\Handtracking systems\Handtracking systems\app.js` | Working prototype | **Hand-local-frame retargeting maths** (proven on `hands_ulkhad.glb`), landmark→world conversion |
| **UE5 pipeline archive** | `Celly\Handtracking systems\_archive_UE_pipeline_2026-10-15\` | Archived | Nothing at runtime; `hand_core.py` documents landmark conventions |

### 1.5 Fonts / audio / HDRIs / textures

**None.** No `.woff2`, `.ttf`, `.mp3`, `.wav`, `.hdr`, `.exr` anywhere.
→ Self-host **Space Grotesk** (display) + **Inter** (body) via `@fontsource` (OFL-1.1).
→ No audio in v0.2 (no sound design was specified).
→ Environment lighting is procedural (PMREM from a generated gradient room), as in v0.1.

### 1.6 Toolchain

Node v24.18.0 · npm 11.16.0 · Blender 5.2 / 4.3 · Playwright 1.64 with Chromium installed.

## 2. Reuse plan

| Need | Source | Action |
|---|---|---|
| 3D hands | `hands_rigged.glb` | Load at runtime; override with a translucent sci-fi material |
| Bone→landmark map | bone names `NN_` | Parse `parseInt(name.slice(0,2))` — no inference |
| Retargeting | `Handtracking systems/.../app.js` | Reimplement in TypeScript, add slerp + world-space placement |
| Cell geometry | `src/cell/shapes.ts` | Port + extend (peroxisome, nuclear envelope, cytoskeleton) |
| Organelle copy | `src/data/organelles.json` + Cellab `O{}` | Merge into new richer schema, EN + FR |
| Maths helpers | `src/util/math.ts` | Port as-is |
| Lab backdrop | `src/scene/LabEnvironment.ts` | Simplify into an ambient lab backdrop (bench, beakers as set dressing) |
| Lighting | `src/scene/Lighting.ts` | Port PBR rig + procedural PMREM |
| MediaPipe runtime | `public/` | Unchanged |

## 3. Missing — generated or written in this build

| Missing | Resolution |
|---|---|
| Cell 3D model | Procedural, §6.3 of the brief. 17 organelle types, every one a named, raycastable group |
| Human hand mesh fallback | Procedural skeletal hand (glassy capsules + joints) if the GLB fails |
| Knowledge network data | Author `knowledge.json`, 36 nodes / ~90 edges |
| Question bank | Author `questions.json`, 48 MCQ + 36 flashcards + 3 × 10 questionnaires |
| Fonts | `@fontsource/space-grotesk`, `@fontsource/inter` (OFL-1.1) |
| UI icons | Inline SVG, hand-authored (no icon font) |

## 4. Licence audit

Everything shipped is MIT / Apache-2.0 / OFL-1.1 or original. No CC-BY-NC, no Sketchfab,
no unclear-licence model. Full table in `CREDITS.md`.
