# Celly — Motion Production Brief

**Client:** Ulrich (Ulkhad Pharaon), solo builder of Celly
**Piece:** 60–90 s explainer animated motion graphic, built to picture-lock against the recorded VO in `SCRIPT.md`
**Deliverable deadline anchor:** picture-lock first, VO recorded against the locked cut — not the reverse

---

## 1. The piece in one paragraph

Celly is a touch-free 3D cell biology lab that runs in the browser: your webcam sees your hands through Google MediaPipe, and pinches / spreads / palm-rotations manipulate a procedural 3D cell. The video's job is to make a viewer *feel* the interaction in the first 10 seconds and *believe* the engineering in the last 20. Visual register: a scientific instrument that happens to be beautiful. Not a game trailer, not a corporate explainer.

**Reference the actual product before designing:** live demo <https://celly-epp.pages.dev>, demo video <https://youtu.be/AT4qeiaPZDg>, source <https://github.com/UlkhadPharaon/Celly>.

---

## 2. Style direction

Three ranked references, in order of importance (client's own taste order):

1. **Futuristic instrument UI** — HUD panels, telemetry, thin hairline rules, corner brackets, monospaced data readouts. Think mission-control, not sci-fi chrome.
2. **Vector geometry** — clean 2D diagrams, precise stroke weights, geometric marks. All diagrams must be true vector (no raster textures).
3. **Glass morphism** — dark translucent panels (62→78 % opacity over dark), 1 px luminous border, soft 10–22 px shadows on floating cards only.

**Hard rules:**
- No scanlines, no glitch effects, no "breathing" pulsing. The product itself deliberately avoids these.
- No stock 3D hand model. The hand skeleton is exactly what ships in the repo: 21 rounded joints, 21 bone lines, left hand **mint**, right hand **amber**. See §5.
- Real product footage/screenshots wherever the VO claims something. Never mock a UI that the app does not actually render.
- Motion always serves comprehension: every animation must explain a relationship (causality, hierarchy, comparison) or none at all.

---

## 3. Design tokens (use the product's real tokens — do not invent a parallel palette)

**Palette**

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#04080f` | base background, all shots |
| `--bg-2` | `#050c17` | background panels, gradient partner |
| `--ink` | `#eaf4ff` | primary text |
| `--ink-soft` | `#9fb6cd` | secondary text, captions |
| `--ink-dim` | `#64809b` | tertiary, data labels |
| `--cyan` | `#4fd8ff` | primary accent: lines, active states, data |
| `--cyan-deep` | `#1f86b8` | accent shadows, gradients |
| `--violet` | `#8b6cff` | secondary accent (stack chips, knowledge graph) |
| `--amber` | `#ffd166` | **right hand skeleton**, highlight accents |
| `--rose` | `#fb7185` | error/contrast only |
| `--green` | `#4ade80` | success/pass only |
| hand-left mint | `#7ee0c3` | **left hand skeleton** (app-specific, not in CSS tokens) |
| glass | `rgba(9,18,32,0.62)` | panel fills |

**Typography**
- Display / headings / wordmark: **Space Grotesk** (400/500/700). Wide tracking on the logo (≈ +80 tracking units), normal for stats.
- Body / captions / data: **Inter** (400/600).
- Data readouts may use Inter tabular figures; no additional fonts.
- Both are SIL OFL 1.1 — free to use and bundle: `@fontsource/space-grotesk`, `@fontsource/inter`.

**Motion language**
- Master easing: `cubic-bezier(0.4, 0.14, 0.2, 1)` for all moves and reveals (this is the app's own easing token — `--ease`).
- Duration scale: micro (chips, points) 120–180 ms; standard (cards, lines) 240–400 ms; hero (cell assemble, wipes) 500–700 ms.
- Ease-outs for entrances, ease-ins for exits. **No overshoot, no bounce, no elastic** — instrument precision, not toy.
- One action per beat; never two competing focal points in frame.
- Grid: 12-column, 64 px margin at 1920 wide, 8 px baseline.

---

## 4. Deliverables & specs

| Deliverable | Spec |
|---|---|
| **Master** | 1920×1080, 16:9, 30 fps, H.264 high profile, ≤ 20 Mbps, LPCM/AAC 48 kHz |
| **Vertical cut** | 1080×1920, 9:16, same picture-lock, safe areas for Reels/TikTok/Shorts (keep all text inside 400 px centre column, ≥ 220 px clear top/bottom) |
| **60 s cut** | same edit minus Shot 3 montage and Shot 5 beat 3 (see §7 Variants) |
| **Stills** | 4 exported PNGs: hero cell, stack diagram, worker diagram, end card (for the Medium article + repo `docs/`) |
| **Project file** | delivered organised, named `CELLY_explainer_v1`, all fonts collected |
| **Captions** | EN + SRT sidecars for both cuts (app is bilingual; French VO variant optional) |

Also deliver the **picture-lock sequence** (VO placed, cut approved) *before* the VO is recorded.

---

## 5. The hand skeleton — exact spec (non-negotiable)

The hands are the product's signature visual. Reproduce the shipped renderer exactly:

- **21 joints, 21 bones** per hand. Bone set: five finger chains + four palm links (`0→17`, `5→9`, `9→13`, `13→17`).
- **Left hand: mint `#7ee0c3`. Right hand: amber `#ffd166`.**
- Bones: 2.2 px coloured line + **4.5 px near-black underlay** beneath (this is what keeps it readable over the bright membrane).
- Joints: rounded points, **constant CSS-pixel size** (do not scale with perspective), each with a dark rim.
- Index-tip joint: **white**; thumb+index tips during pinch: warm white; pinch contact point: soft additive glow.
- Depth: hands draw **above** the cell and above bloom, `depthTest` off.
- Index fingertip sits exactly under the tracked cursor at all times.

Reference frames in the repo: `docs/screenshots/11-two-hands-scale.png`, `docs/screenshots/02-onboarding-hands.png`, and the full pose suite in `docs/screenshots/hand-tests/` (13 poses + debug view).

---

## 6. Storyboard

Full VO and per-shot direction in `SCRIPT.md`. The board:

| # | Shot | Time | Visual | Key on-screen |
|---|---|---|---|---|
| 1 | Hook | 0:00–0:08 | Cell assembles, 15 organs stagger in; two hand skeletons bloom from frame edges | `CELLY` / *touch-free 3D biology* |
| 2 | Gesture | 0:08–0:18 | Real product footage: pinch-select, dim, scale | `pinch → select` · `two hands → scale` · `palm → rotate` |
| 3 | Goal | 0:18–0:30 | Flat textbook diagram wipes to living cell | `15 organelles · 36 concepts · 48 questions` + `MIT · 43 commits · 44 days · 187 tests` |
| 4 | Stack | 0:30–0:46 | Tech-flow: chips connect; webcam frame with numbered 21-point skeleton overlay | `TypeScript 6 → Vite 8 → Three.js → MediaPipe HandLandmarker → Cloudflare Pages` |
| 5 | Under the hood | 0:46–1:02 | Worker/workerless diagram; pinch curve drawing itself; data panel | `56 ms → 0 ms main-thread inference` · pinch formula · `10/10 · 1.6 px selection error` |
| 6 | Close | 1:02–1:12 | Hero framing, hands mid-gesture, freeze on pinch | `celly-epp.pages.dev` · `github.com/UlkhadPharaon/Celly` · QR |

### Key diagram specs

**Shot 4 — 21-point skeleton overlay.** Numbered landmarks appear in order with 60 ms stagger; call out only #0 wrist, #4 thumb tip, #8 index tip (the three the pinch maths actually uses). Draw the palm width vector `mcp5 → mcp17` as the normaliser — it sets up Shot 5's formula.

**Shot 5 beat 1 — worker diagram.** Two lanes: `inference` box and `render loop` box, separated by a labelled barrier (`module worker`). Show the "before" state briefly: a 56 ms block stalling the render lane (red-tinted lane, frame ticks stopping), then the solved state: render lane unbroken, inference lane running in parallel, label `main thread: 0 ms inference`. Do not show fake FPS graphs — the labelled number is the claim, keep it.

**Shot 5 beat 2 — pinch curve.** Draw the smoothstep curve itself: x-axis = gap / palm width, y-axis = pinch value. Shade the dead zone `0.10k–0.55k`; label the hysteresis band: `active > 0.55 · release < 0.38`. Annotate the real-hand insight: `pads touch, marker centres stay ~2 cm apart → natural pinch saturates at 1.0`.

**Shot 5 beat 3 — data panel.** Real repo numbers only: `187 unit tests · 31 e2e · 62 decisions · 10/10 selection · 1.6 px mean error · 83 draw calls · 79,522 triangles`. No invented metrics.

**Shot 6 — end card.** Wordmark, both URLs, QR to `https://celly-epp.pages.dev` (generate at ≥ 1000 px, quiet zone ≥ 4 modules).

---

## 7. Variants

- **60 s cut:** remove Shot 3's montage (fold the sentence into Shot 2's first 3 s), remove Shot 5 beat 3. Everything else identical.
- **9:16:** re-block, not reframe: stack diagram becomes vertical; Shot 5 beats stack vertically under the VO beat labels; end card centred. Re-time all holds ≥ 1.5 s (mobile attention).
- **FR variant:** swap VO and captions only; picture-lock unchanged.

---

## 8. Assets available in the repo (F:\TKS\BUILD\Celly\docs\)

| Asset | Path | Use |
|---|---|---|
| 11 product screenshots (1600 px wide) | `docs/screenshots/01…11-*.png` | Shots 2–3, end-card backdrop, article |
| Hand pose suite (13 poses + debug + selection test) | `docs/screenshots/hand-tests/` | skeleton spec reference, Shot 4 |
| Social preview card | `public/og-celly.jpg` | end-card colour reference |
| Design tokens (this brief's palette) | `src/styles/main.css` §tokens | authoritative colour source |
| Decision log D-01…D-62 | `DECISIONS.md` | verify any technical claim before animating it |
| Demo video | <https://youtu.be/AT4qeiaPZDg> | real product motion (re-record 4K if needed) |

Working files produced by this project land in `docs/publish/` (article, this brief, the script).

---

## 9. Audio direction

- **VO:** first person, ~145 wpm, steady. Direction: a builder explaining a machine, not a marketer selling one. Record against locked picture; 300 ms pauses between sentences; full beat before each numbered beat in Shot 5. Emphasis words listed in `SCRIPT.md`.
- **Music:** ambient / cinematic-tech, minimal. Sub pulse under the cell assembly (Shot 1); small lift at Shot 3's wipe; build under Shot 5; resolve on the Shot 6 hold. −18 to −14 LUFS under VO.
- **SFX (sparing, never decorative):** sub-drop on assembly; soft UI tick per gesture commit; quiet digital ticks on stack connections (5); whoosh per beat transition in Shot 5; final music button on the freeze frame.
- **Mix:** VO centre and dominant, music ducked −8 dB under VO. Master −16 LUFS integrated for social platforms.

---

## 10. Review & approval

Two rounds: (1) animatic / picture-lock — timing, shot order, text, no final polish; (2) final render — full quality, sound, variants and stills. Fact-check every on-screen number against `DECISIONS.md`, `CHANGELOG.md` and `README.md` before Round 2; anything unverifiable comes out.