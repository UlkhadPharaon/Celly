# Celly — Explainer Video Script (60–90s)

**Purpose:** present Celly in a single short video for socials (YouTube, LinkedIn, Shorts/Reels/TikTok) — what it is, why it exists, how it was built, and the engineering depth behind it.
**Voice:** the builder (Ulrich), first person, direct, confident. French or English VO accepted — record both if possible (the app itself is bilingual EN/FR).
**Target runtime:** ~85 seconds. VO word count ≈ 205 words at ~145 wpm.

---

## Shot-by-shot script

### SHOT 1 — THE HOOK (0:00 – 0:08)

**VO:**
"I built a 3D cell biology lab you explore with your bare hands. No controller. No headset. No gloves. Just your webcam — and one pinch."

**On screen:**
- `CELLY` wordmark (Space Grotesk Bold, tracking wide, fades in letter by letter)
- Subtitle: *touch-free 3D biology*

**Visual:** Full-bleed dark navy. A procedural cell materialises — 15 organelles assembling one by one on the beat, membrane fresnel glow. Two hand skeletons bloom in from the frame edges: left mint `#7ee0c3`, right amber `#ffd166`.

**Motion:** Assemble sequence, 6 frames per organelle stagger, cubic-bezier(0.4, 0.14, 0.2, 1). Nothing bounces.
**Audio:** Low sub-drop on the cell assembly. Music bed starts: ambient, cinematic, minimal.

---

### SHOT 2 — THE GESTURE (0:08 – 0:18)

**VO:**
"A pinch on the mitochondria selects it. Spread two hands and the cell scales. Your own palms turn it around. Every gesture has a mouse equivalent, so it works with or without a camera."

**On screen:** gesture captions, one per action, bottom-left, 2-second hold each:
`pinch → select` · `two hands → scale` · `palm → rotate`

**Visual:** The app's real UI running: right-hand pinch picks the mitochondrion, the rest of the cell dims to 32 %, info card anchors in. Both hands enter frame and scale the cell. (Screen-capture from the demo video or Playwright-generated footage.)

**Audio:** Soft UI tick on each gesture commit.

---

### SHOT 3 — THE GOAL (0:18 – 0:30)

**VO:**
"Every biology student memorises the same flat diagram. I wanted the opposite: a cell you can hold. Because interaction forces questions a page never asks. So I built it — solo, in six weeks, open source."

**On screen:** killer stat block, animating one line at a time:
```
15 organelles · 36 concepts · 48 questions
MIT · 43 commits · 44 days · 187 tests
```

**Visual:** Split-feel montage: flat textbook diagram (desaturated, static) → wipes to the living 3D cell. Left half of frame holds the diagram and dissolves as the cell fills frame.

**Audio:** Music lifts slightly on the wipe.

---

### SHOT 4 — THE STACK (0:30 – 0:46)

**VO:**
"The stack is deliberately lean. TypeScript and Vite, Three.js for WebGL, and Google's MediaPipe Hand Landmarker running fully on-device — twenty-one tracked points per hand, no server, no upload, no framework."

**On screen:** stack chips typing on in sequence, then connecting into a flow line:
`TypeScript 6` → `Vite 8` → `Three.js` → `MediaPipe HandLandmarker` → `Cloudflare Pages`
small caption under each: `strict` / `fast builds` / `WebGL2` / `on-device` / `static`

**Visual:** Tech-flow diagram: chip → chip → chip, connecting lines drawing themselves. Beside it, a minimised webcam frame with the 21-landmark skeleton overlaying — points appear in sequence, numbered (#0 wrist, #4 thumb tip, #8 index tip).

**Motion:** Lines draw with a 400 ms dash offset; points pop in at 60 ms stagger.
**Audio:** Digital "connect" ticks (5 total, quiet).

---

### SHOT 5 — UNDER THE HOOD (0:46 – 1:02)

**VO:**
"The interesting engineering is everything after the points. Inference runs in a worker, so rendering never stalls. The pinch is a dead-zoned ratio, because finger pads touch while the tracked centres stay apart. And the gesture engine is a pure state machine — which is how I test a webcam I can't unit-test."

**On screen:** three numbered beats matching the VO, 5 seconds each:
1. `inference → worker · render never blocks` (56 ms → 0 ms on main thread)
2. `pinch = 1 − smoothstep(0.10k, 0.55k, gap/palm)`
3. `187 unit tests · 31 e2e · 62 decisions`

**Visual:** Beats 1–2 as animated diagrams (worker box beside the render loop with a "no-block" barrier; the pinch curve drawing itself, dead zone shaded, hysteresis band labelled enter 0.55 / exit 0.38). Beat 3 as a data panel — real numbers from the repo: `10/10 selection · 1.6 px error`.

**Audio:** Whoosh on each beat transition. Music builds.

---

### SHOT 6 — THE CLOSE (1:02 – 1:12)

**VO:**
"Celly is live, open source, and built to be studied. Link in the description — hold a cell in your hands, and tell me what you learn."

**On screen:** end card:
`celly-epp.pages.dev` (large)
`github.com/UlkhadPharaon/Celly` (smaller, MIT)
QR code to the live demo, bottom-right.

**Visual:** Final hero framing — full cell, both hands mid-gesture, frozen on the frame where the pinch lands. Logo settles; QR scales in with the music button.

**Audio:** Final music button on the hold, then decay to silence by 1:12.

---

## Runtime summary

| # | Shot | Duration | Cumulative |
|---|---|---|---|
| 1 | Hook | 8s | 0:08 |
| 2 | The gesture | 10s | 0:18 |
| 3 | The goal | 12s | 0:30 |
| 4 | The stack | 16s | 0:46 |
| 5 | Under the hood | 16s | 1:02 |
| 6 | Close | 10s | 1:12 |

**Total: 72 seconds of visuals, ~205 words of VO (~85 s spoken at 145 wpm).** If the recorded VO runs long, trim Shot 5 beat 3 and shorten Shot 3's stat block — never the stack or the pipeline explanation, they are the credibility payload.

## Delivery notes for the VO artist

- Read pace: steady, ~145 words/minute. Pause 300 ms between sentences, full beat before each numbered beat in Shot 5.
- Emphasis words (hit these): **bare hands** (S1), **pinch** (S1–S2), **six weeks** (S3), **on-device** (S4), **worker** + **pure state machine** (S5).
- Record 60s and 90s variants: the 60s cut removes Shot 3's montage and Shot 5 beat 3 (see PRODUCTION-BRIEF.md, Variants).