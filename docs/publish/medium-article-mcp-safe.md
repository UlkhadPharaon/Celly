*The canonical clean-markdown version of this article is `medium-article.md` (same folder) — use it with Medium's official import at medium.com/p/import if you want native headings, tables and code blocks. This variant is tuned for the Medium MCP's automated publisher, whose markdown converter drops horizontal rules, language-tagged code fences and tables.*

## The first time the pinch worked

I had been staring at a number that refused to move. My pinch detector read **0.61** — permanently. Thumb touching index finger, the most obvious gesture in the world, and my code sat in a dead zone between "open hand" and "pinched."

That single number — a ratio of fingertip gap to palm width — was the difference between a biology demo and something that felt like a superpower. When I finally understood *why* it was stuck, the fix took one line. The lesson took six weeks.

This is the story of [**Celly**](https://celly-epp.pages.dev) — a 3D cell biology lab you explore with your bare hands, no controller, no headset, no gloves. A webcam and a pinch are the entire interface. It is open source, MIT-licensed, and it runs entirely in your browser.

- **[Try the live demo](https://celly-epp.pages.dev)** — camera permission required, or use the mouse fallback
- **[Watch the 90-second demo video](https://youtu.be/AT4qeiaPZDg)**

![The Celly interactive lab — a procedural cell with 15 selectable organelles](F:/TKS/BUILD/Celly/docs/screenshots/04-lab.png)

## The problem with learning cell biology from a page

Every biology student memorises the same diagram: an oval, some blobs, arrows pointing at words. The mitochondrion is "the powerhouse of the cell" and nobody has ever seen one, turned one over in their fingers, or watched what happens when you take the nucleus away.

I had already written about this in [How to make school more valuable](https://medium.com/@ulrichtapsoba2009/how-to-make-school-more-valuable-94ac46cecc32?sharedUserId=ulrichtapsoba2009) — the argument that learning improves when the body participates. Celly is that argument, executed as software.

The thesis is simple, and it is the whole project in one sentence:

**A cell you can hold teaches you more than a cell you can only look at.**

Not because 3D is magic, but because interaction forces questions. When your own hand rotates the cell and your own pinch pulls the Golgi forward, you stop asking "what is this called?" and start asking "what happens if…?"

## What Celly is

Three sections, one continuous 3D scene:

- **Interactive Lab** — rotate, scale, isolate and read 15 organelles on a procedural cell
- **Knowledge** — fly through a 36-node graph of cell-biology concepts
- **Test** — quizzes, a full exam, guided question sets and Leitner flashcards, all gesture-driven

The gesture vocabulary is deliberately small. Six gestures run the entire app:

- Right **pinch** on an organelle — **select** it: focus, dim the rest, open the info card
- Right **pinch** on empty space — **unselect**
- Left pinch + move — **rotate**, absolute, following your palm
- Both hands pinch — **scale**: spread to grow, bring together to shrink
- Pinch + horizontal drag — **swipe** to the next or previous item
- Pinch on a button — **click**

Everything also works with a mouse. Click = pinch, drag = rotate, wheel = scale. The camera never *has* to start — that fallback turned out to be one of the most important design decisions in the project.

![Two-hand scale: both hands tracked, spreading them apart scales the cell](F:/TKS/BUILD/Celly/docs/screenshots/11-two-hands-scale.png)

## Six and a half weeks, 43 commits

`git log` is honest about how this was actually built. First commit **October 13, 2026**. Latest commit **November 26, 2026**. Forty-four days, 43 commits, one person.

- **Oct 13–15** — research, then v0.1: procedural cells, named organelle parts, a laboratory environment
- **Oct 22–23** — the ground-up rebuild into Celly v0.2: hand tracking, the gesture engine, all three sections
- **Oct 23–24** — v0.2.1, the real-device pass: pinches that finally work on actual hands
- **Oct 24** — performance: the skeleton hand, device budgets, responsive shell
- **Oct 25–27** — deployments, and the cursor moves to the fingertip
- **Oct 31 – Nov 1** — the skeleton hand overlay and a live onboarding camera check
- **Nov 7** — hand inference moves off the main thread, the biggest performance fix
- **Nov 8** — a five-phase audit: accessibility, interaction, docs, performance
- **Nov 25–26** — tracking recovery, the learning study build, production deployment

The pattern that emerges: **build, break on real hardware, diagnose the root cause, rebuild it properly.** The v0.1 to v0.2 rebuild was not a rewrite for its own sake — it replaced a cell viewer with a complete gesture-driven application, one section at a time, each one testable before the next started.

## The stack, and why each piece is there

- **TypeScript 6.0.3**, strict mode — a 17,000-line app with 62 documented decisions needs the compiler as a safety net
- **Vite 8.3.4** — fast dev server, first-class worker support, lean output
- **Three.js 0.186.1** — WebGL2 rendering: the cell, the graph and the hands
- **MediaPipe Tasks Vision 1.1.0** — on-device 21-point hand landmarker, GPU delegate with CPU fallback
- **Vitest 5.0.4** — 187 unit tests on the pure modules
- **Playwright 1.64.0** — 31 e2e tests driving synthetic hands through the real pipeline
- **Cloudflare Pages** — static hosting; HTTPS is what unlocks the camera
- **No UI framework** — vanilla TypeScript and a 60-line reactive store; a WebGL app does not need a virtual DOM

Three "no" decisions shaped the architecture more than any library choice.

**No UI framework.** The UI is mostly imperative WebGL plus anchored DOM cards. A framework would have added a build layer and per-frame reconciliation cost without removing any complexity.

**No animation library.** The entire animation system is a ~140-line tween engine. GSAP would have cost roughly 70 kB to do less.

**No third-party 3D cell model.** Every cell in the NIH 3D Print Exchange or on the marketplaces was either non-commercial (CC-BY-NC) or a fused 3D-printing shell with no semantically separable parts. I could not isolate, ghost or recolour an organelle in a print-oriented mesh. So the cell is **procedural** — one named mesh per organelle, generated at runtime, zero asset weight, and licence-clean by construction.

## How a bare hand becomes a cursor

This is the part of the project I am proudest of, because nothing about it is obvious.

### The pipeline

The whole input path, end to end:

```
camera  -->  trackingWorker (module worker)
             MediaPipe HandLandmarker: 21 landmarks per hand, 2 hands
             ImageBitmap in, detection out, single-flight, one frame at a time
                     |
                     v
          main thread: One-Euro filter --> pinch maths --> gesture state machine
                     |                                        |
                     v                                        v
          skeleton overlay (21 points, 21 bones)    select / rotate / scale / swipe
```

The landmarker returns **21 keypoints per hand** in normalized image coordinates, plus "world" landmarks in metres, plus handedness. That is the entire input. Everything else — pinch, rotate, scale, select — is maths I wrote on top of those 63 numbers.

### The pinch: a dead-zoned ratio, not a distance

The naive approach — "distance between thumb tip and index tip below X means pinch" — fails immediately, because that distance depends on hand size and distance from the camera. Normalise it by hand size and you still fail, because of the problem that cost me days:

**Finger pads touch while the tracked marker centres stay 1–3 cm apart.**

MediaPipe's landmark 4 and landmark 8 are the *centres of the pads*, not the skin. When you actually pinch, they never reach zero. A raw ratio stalls around 0.5 to 0.6 — the number that refused to move — and hysteresis thresholds set for the idealised geometry never fire.

The fix was a **dead zone and a smoothstep**. The ratio is the thumb-tip to index-tip gap divided by palm width (the MCP 5 to MCP 17 span, which is distance-invariant), and the pinch value is one minus a smoothstep of that ratio between 0.10k and 0.55k, where k is the sensitivity. The gesture activates above 0.55, releases below 0.38 for hysteresis, and must hold for 70 ms before it commits:

```
r     = |tip(4) - tip(8)| / palmWidth(mcp5 -> mcp17)
pinch = 1 - smoothstep(0.10k, 0.55k, r)
```

The dead zone is the whole trick: a natural, pad-to-pad pinch now saturates at **1.0**, while a fully open hand still reads **0**. Sensitivity is a persisted setting — Firm 0.8, Normal 1.0, Light 1.3 — so the same hand can be tuned to a camera, a hand size or a lighting setup without touching code.

One more detail the maths forced: I compute the ratio in **normalized image space** and only blend MediaPipe's metric world landmarks in when the two agree. MediaPipe's z axis is the noisiest channel at arm's length, and trusting it broke the gesture on real hands.

### Rotation is absolute, not accumulated

Rotating by "how much your hand moved this frame" feels terrible: a tremor reverses direction, and one bad detection whips the model. Celly anchors your palm position at the start of the gesture and eases the rig toward `anchor + (palm − anchorPalm) × gain`. A still hand gives a still target. Nothing drifts. A single large jump is clamped, so one bad frame cannot spin the cell.

### The hand you see is 21 joints, not a 3D model

The first builds tried everything: an authored rigged GLB hand, then a generated low-poly skinned mesh with 1,149 vertices and 21 bones, with a retarget solver, rest-pose calibration and a skin-weight audit.

All of it was deleted.

The shipped hand is **21 rounded points and 21 bone segments** — the five finger chains and four palm links — drawn directly from the landmarks. It removed a retarget solver, a skinning pass, a skin audit, three render paths, 9 MB of GLBs, and a large share of the frame budget. The joints keep a constant CSS-pixel size, a dark underlay keeps them readable over a bright membrane, and the index fingertip sits exactly under the tracked cursor at any viewport size.

**Selection precision became measurable:** the built-in selection test drives ten organelles through the real pinch pipeline and reports hit rate and mean aim error. The final run: **10/10 targets, 1.6 px mean error.**

![Selecting an organelle — the rest of the cell dims, the info card anchors to the part](F:/TKS/BUILD/Celly/docs/screenshots/05-lab-selected.png)

## The bug that taught me the most: inference on the render thread

In v0.2.0, hand inference ran synchronously on the main thread. The decision had a rationale — MediaPipe in VIDEO mode returns synchronously, and the plan assumed roughly 4 to 8 ms per call on the target GPU.

The measurement on the laptop I actually develop on said otherwise:

- **Inference latency p50 — 56.2 ms**
- **Inference latency p95 — 92.8 ms**
- **Long tasks over 50 ms in a 6-second window — 74**
- **Frame rate with the camera on — about 20 fps**
- **Frame rate, render only — about 100 fps**
- **Tracker throughput — 14 to 15 Hz**

Fifty-six milliseconds inside `requestAnimationFrame` is a stalls-every-frame machine. Aiming became a slideshow, and no amount of hysteresis or damping could hide it.

The fix — move inference into a **module worker** — is now structural, not a tuning knob. Because only the worker imports `@mediapipe/tasks-vision`, **the production main bundle contains no reference to `HandLandmarker` or `detectForVideo` at all** (verified by grepping the built output). The original bug cannot come back by accident; it would have to be deliberately re-imported onto the main thread.

Two things made the worker viable, and both came from earlier decisions: the skeleton hand (D-56) removed the per-frame CPU retarget solver that would have had to live outside the worker, and single-flight `ImageBitmap` pumping means frames are *consumed*, never queued. When a worker fails to init, the app says so clearly and falls back to mouse mode — I deliberately did **not** build a main-thread fallback, because that would reintroduce the exact stall.

### And the skeleton that flashed

A second bug is my favourite because the fix is so small. Tracking a hand, the skeleton would flicker out for a frame, then return. The cause: MediaPipe's default tracking confidence of 0.5 dropped hands that were *already being tracked* on a single weaker frame. Lowering it to 0.35 and extending the hand-loss window from 420 ms to 550 ms fixed it permanently. A held hand now survives one bad frame without leaving a ghost behind.

## Testing software whose input is a human hand

You cannot unit-test a webcam, and you should not ask humans to hold reproducible poses for 31 tests. So the synthetic hand goes through the **real pipeline**:

`window.__celly.injectHand` feeds a fully-formed 21-landmark hand into the exact same code path as a camera — hover, the gesture state machine, intents, selection. The e2e suite and every documentation screenshot are generated this way. What the tests exercise *is* what a camera produces.

That design decision paid for itself constantly:

- **187 unit tests** cover pinch hysteresis, fist rejection, the side resolver, every gesture-state transition, the Leitner scheduler, content integrity (15 organelles, 36 nodes, 48 questions, 36 flashcards), and the study instrument's export schema
- **31 e2e tests** run with Chrome's fake camera, so MediaPipe initialises for real, then inject synthetic hands to select an organelle, open and close the overlay, navigate the knowledge graph and verify the two-hand scale
- **62 numbered decisions** (D-01 to D-62) record every architectural ruling — including the ones superseded later. D-12 ("tracking on the main thread, not a worker") is kept in the log marked *superseded by D-59*, because the reasoning that led to a wrong decision is as valuable as the fix

The knowledge graph is a seeded Fruchterman–Reingold force layout with a fixed tick count — the same graph on every load, which is what makes deterministic screenshots and reproducible e2e tests possible.

![The knowledge graph — 36 authored nodes, deterministic layout, gesture-driven navigation](F:/TKS/BUILD/Celly/docs/screenshots/06-knowledge.png)

## A research instrument, not just a toy

Celly's latest build is an experiment. Before anything renders, a participant picks one of three learning conditions:

- **Hand tracking** — the 3D cell, driven by bare-hand pinches
- **Mouse** — the same 3D cell, driven by clicks; the camera never starts
- **Textbook** — the same content as a written textbook: eight chapters, no 3D, no camera

Everyone then follows the same path: read or explore, then a 10-question quiz, then a short survey, then a completion screen with an anonymous participant code. Nothing is uploaded; each profile is stored on the device and exports as CSV or JSON.

If the goal is understanding whether embodied interaction actually teaches better, the honest answer requires comparing it against the alternatives — including the one that looks the most old-fashioned.

## Privacy is an architecture, not a policy

- Camera frames are processed **on this device**, in WebAssembly. Nothing is uploaded, recorded or persisted
- The WASM runtime and the 7.8 MB model are self-hosted. After first load the app is **offline-capable** — there is no per-frame network call because there is no server
- No analytics, no cookies, no accounts. Learning state lives in `localStorage`
- No hand meshes, textures or rigs ship: the skeleton is generated from landmarks at runtime

Performance is budgeted by device profile *before the first frame* — phone, tablet or desktop each get an explicit DPR cap, camera resolution, shadow and bloom policy. With one skeleton hand in frame, the lab measures **83 draw calls and 79,522 triangles** at 1280×800.

## Shipping it

The live demo is a **Cloudflare Pages** project built from the `main` branch. One deployment lesson worth its own paragraph, because it cost an evening:

The first git-based build served the **repository root** instead of the build output, so the live site loaded the *source* `index.html` — which points at `/src/main.ts`, a module that does not exist in a browser. The symptom was a perfectly black screen on a perfectly successful deploy. The fix was two parts: `pages_build_output_dir = "dist"` in `wrangler.toml`, **and** a build configuration in the Pages dashboard. Both halves matter.

## What's next

- **WebXR** — the renderer is created once and the gesture module is pure, so an `XRSession` hook point is a documented no-op stub; flipping it on does not touch the hand pipeline
- **Osmosis simulations** — a scalar volume ODE with real water-potential physics (van't Hoff), driving membrane deformations
- **Audio** — deliberately absent in v0.2, because it would force autoplay-policy handling on the first gesture
- **Study results** — once enough participants have completed all three conditions

## The one-line version

If you take one thing from this: the hard part of gesture interfaces is not the machine learning. MediaPipe hands you 21 landmarks and it works well. The hard part is everything *after* the numbers — the dead zones, the hysteresis, the absolute-versus-accumulated choice, the frame budget, the filter that neither jitters nor lags. That is where the product lives, and that is where the six weeks went.

## References and links

**The project**

- Live demo: <https://celly-epp.pages.dev>
- Source (MIT): <https://github.com/UlkhadPharaon/Celly>
- Demo video: <https://youtu.be/AT4qeiaPZDg>
- My earlier article: [How to make school more valuable](https://medium.com/@ulrichtapsoba2009/how-to-make-school-more-valuable-94ac46cecc32?sharedUserId=ulrichtapsoba2009)

**Technology used**

- MediaPipe Hand Landmarker (Google AI Edge) — <https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker>
- MediaPipe Tasks Vision on the web — <https://developers.google.com/mediapipe/solutions/vision/hand_landmarker/web_js>
- Three.js — <https://threejs.org>
- Vite — <https://vite.dev>
- Vitest — <https://vitest.dev>
- Playwright — <https://playwright.dev>
- Cloudflare Pages — <https://developers.cloudflare.com/pages>
- The 1€ Filter (Casiez, Roussel & Vogel, CHI 2012) — <https://gery.casiez.net/1euro>
- Fruchterman & Reingold, *Graph Drawing by Force-Directed Placement*, Software: Practice and Experience 21(11), 1991 — <https://doi.org/10.1002/spe.4380211102>
- The Leitner system — <https://en.wikipedia.org/wiki/Leitner_system>

**Biology references**

- LibreTexts Biology 2e (open textbook, CC-BY) — <https://bio.libretexts.org>
- OpenStax Biology 2e (open textbook, CC-BY) — <https://openstax.org/details/books/biology-2e>

*Celly is MIT-licensed and open source. The MediaPipe model and WASM runtime are redistributed unmodified under Apache-2.0. Every architectural decision referenced in this article is documented in the repository's `DECISIONS.md` (D-01 to D-62).*