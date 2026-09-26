# ColProj — Context for an AI assistant

Paste this into a fresh session before asking for changes. It describes what
exists, why it is built the way it is, and what must not be broken.

Written 26 September 2026. Project review: 1 October 2026.

---

## 1. The project in one paragraph

ColProj marks classroom attendance from a photograph. A teacher photographs
their class; the app detects faces, matches them against the enrolled students
of that specific class, and produces a roll. It runs entirely on an Android
handset with no server and no network. It is built by a four-person SPPU
engineering team (two people actually working) as a final-year project, with the
intention of later integrating it into the college ERP. The standalone build
exists to prove the idea before that integration is approved.

---

## 2. Current state

Working and tested. 79 automated tests pass across three suites.

Delivered:
- Full application in `www/`, loads as plain `<script>` tags, no bundler.
- Real ONNX inference with bundled model weights.
- Single-file build at `dist/colproj.html` (144 KB) via `build.py`.
- Capacitor config ready; `npx cap add android` produces the APK.
- `README.md` (build + decisions), `docs/MANUAL.md` (user manual), this file.

Not done: ERP integration, Google Workspace SSO, liveness detection,
model fine-tuning, consent/retention workflow. See §9.

---

## 3. Environment constraints that shaped the build

These mattered and may matter again.

- **The build sandbox could not reach Google Drive**, where every public
  RetinaFace weight file is hosted. Hence SCRFD (§6.1).
- **Published-artifact sandboxes block fetches to model CDNs**, so the
  single-file build cannot load ONNX weights. This is why the engine is
  pluggable rather than hardcoded (§5.3).
- **No Android SDK in the build environment**, and Google's Maven hosts were
  unreachable, so the `.apk` could not be compiled there. The Capacitor wrap is
  a local step for the team.
- **No browser in the build environment.** All testing is jsdom + Node. There
  is therefore no screenshot-level verification of layout; visual bugs are
  possible and have not been ruled out.

---

## 4. File map

```
colproj/
  README.md                 build, deployment, decisions to defend
  docs/MANUAL.md            end-user manual, screen by screen
  docs/CONTEXT.md           this file
  build.py                  inlines www/ into dist/colproj.html
  capacitor.config.json     appId in.edu.college.colproj, webDir www
  package.json              scripts: start, test, build, android:*
  test/
    logic.test.mjs          pure logic under node:vm (21 tests)
    flow.test.mjs           full app under jsdom (52 tests)
    dist.test.mjs           boots the built single file (6 tests)
  www/
    index.html              boot sequence; script order matters
    css/app.css             one stylesheet, design tokens on :root
    js/core.js              storage, crypto, roles, gate, seed  (~640 lines)
    js/engine.js            detect, align, embed, match         (~560 lines)
    js/ui.js                shell, router, auth, capture, review (~640 lines)
    js/admin.js             roster, enrol, staff, UAT, audit    (~700 lines)
    js/ort.wasm.min.js      onnxruntime-web 1.19.2, WASM backend
    js/ort-wasm-simd-threaded.{wasm,mjs}
    models/det_500m.onnx    SCRFD-500M,  2.5 MB
    models/w600k_mbf.onnx   ArcFace MobileFaceNet, 13.6 MB
```

**Script load order is a hard dependency**: `core.js` → `engine.js` → `ui.js` →
`admin.js`. `admin.js` writes into the `VIEWS` and `ACTIONS` objects declared in
`ui.js`.

**A subtlety that has already cost time twice.** Top-level `const` and `class`
in a classic `<script>` live in the global *lexical* environment. Sibling
scripts can reference them directly, but they never become properties of
`window`. Test harnesses must therefore inject a bridge script that does
`Object.assign(window, { App, DB, ... })`. This is not a bug and must not be
"fixed" by converting declarations to `var` or `window.X =`.

---

## 5. Architecture

### 5.1 Storage

IndexedDB, database `colproj`, version 1. Object stores, all keyed on `id`
except `kv` which is keyed on `k`:

`users, depts, klasses, students, templates, timetable, sessions, attendance, requests, audit, kv`

Thin wrapper `DB` in `core.js`: `get, all, put, putAll, del, clear, where, wipe`.

`localStorage` holds exactly three things, all of which are per-device and must
never sync or be exported: `colproj.device` (handset id), `colproj.coach`
(walkthrough progress), `colproj.coach.on`.

Settings live in IndexedDB under `kv/settings` so that a full export captures
them.

### 5.2 Entities

```
users      { id, name, email, role, deptId, active, deviceIds[],
             mfaEnabled, totpSecret, pw:{salt,hash,iters}, mustSetPassword }
depts      { id, code, name }
klasses    { id, deptId, year:'SE'|'TE'|'BE', division:'A'|'B', name }
students   { id, klassId, roll, seat, name, admitType:'regular'|'direct-se',
             enrolledAt, active }
templates  { id, studentId, emb:ArrayBuffer(512*4), chip:dataURL|null,
             active, source:'enrol'|'dispute', createdAt, createdBy,
             sessionId?, retiredAt?, retiredBy? }
timetable  { id, teacherId, klassId, day:0-6, start:'HH:MM', end:'HH:MM', subject }
sessions   { id, klassId, teacherId, slotId, date, startedAt, closedAt,
             deviceId, overrideReason, engine, shots, threshold, stats,
             present, total, status, seal }
attendance { id, sessionId, studentId, state:'present'|'absent', flagged,
             conf, source:'auto'|'manual'|'override', crop, editedBy, at }
requests   { id, type:'substitute'|'transfer', status:'pending'|'accepted'|'declined',
             from, to, createdAt, decidedAt, payload }
audit      { id, seq, ts, actor, device, action, detail, prevHash, hash }
```

Note `attendance.state` is only ever `present` or `absent` once saved. The
`review` state exists during a live session and is collapsed to
`absent` + `flagged: true` at save time. Nothing is silently dropped.

### 5.3 The engine interface

Everything downstream of these two methods is engine-agnostic. Do not leak
engine specifics into the UI.

```js
engine.detect(source, { detScore, shotIndex }) -> [{ box:[x1,y1,x2,y2], kps:[[x,y]×5], score, _who?, _noise? }]
engine.embed(chips, dets)                      -> [Float32Array(512)]  // L2-normalised
```

Three implementations in `engine.js`:

| id | Class | Notes |
|---|---|---|
| `onnx` | `OnnxEngine` | Real weights. Requires `ort` global and files in `models/`. |
| `synthetic` | `SyntheticEngine` | No weights. Statistically faithful (§6.3). |
| `fixture` | `FixtureEngine` | Replays a recorded frame list for repeatable UAT. |

`buildEngine(pref, opts)` resolves `'auto'` by probing for `models/det_500m.onnx`
and falling back to the simulator. `ensureEngine()` in `ui.js` caches the
instance on `App.engine`; setting `App.engine = null` forces a rebuild, which
the UAT sliders do when simulator parameters change.

### 5.4 Routing

No framework, no hash routing. `VIEWS[name]` is an async function returning an
HTML string; optional `VIEWS[name + ':mount']` runs after insertion for
imperative wiring. `go(view, params)` pushes the stack, `back()` pops it.
`ACTIONS[name]` handlers are bound by delegation on `[data-act]`.

All interpolated content must go through `esc()`. There is no sanitiser beyond
this.

---

## 6. The parts that took real work

### 6.1 Models

**Detector: SCRFD-500M** (`det_500m.onnx`, 2.5 MB), from the InsightFace
`buffalo_sc` pack. Input `[1,3,H,W]` dynamic, RGB, `(x-127.5)/128`. Nine
outputs: score/bbox/kps × strides 8/16/32, 2 anchors per cell. Outputs are
grouped by trailing dimension (1/4/10) and sorted by descending row count
rather than by name, because the exported names are opaque integers.

**Recogniser: ArcFace w600k_mbf** (`w600k_mbf.onnx`, 13.6 MB). MobileFaceNet
backbone, ArcFace loss, WebFace600K. Input `[N,3,112,112]` RGB,
`(x-127.5)/127.5`. Output `[N,512]`, L2-normalised after inference.

**Why not RetinaFace.** All public weights are on Google Drive, unreachable
from the build sandbox; the ResNet50 variant is 100+ MB, not shippable. SCRFD
is by the same authors, is RetinaFace's direct successor, and beats it on WIDER
FACE at lower compute. `OnnxEngine._decodeRetina` implements the full
RetinaFace prior-box decode (steps 8/16/32, min sizes
`[[16,32],[64,128],[256,512]]`, variances `[0.1,0.2]`), and `DETECTORS.retinaface`
holds its config. Drop `retinaface_mnet025.onnx` into `models/` and construct
with `{ detector: 'retinaface' }` to switch. **This path has never been run** —
no weights were available to test it. Treat it as written-but-unverified.

### 6.2 Alignment

Faces are aligned to the standard 5-point ArcFace template for 112×112:

```
[[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],[41.5493,92.3655],[70.7299,92.2041]]
```

`similarityTransform()` uses a closed-form least-squares similarity (scale +
rotation + translation, no reflection) rather than an SVD:

```
a = Σ(p·q)/Σ|p|²,  b = Σ(p×q)/Σ|p|²,  M = [[a,-b],[b,a]], t = mq - M·mp
```

Verified against Umeyama over 500 random landmark sets: max absolute difference
`3.0e-5`, i.e. float32 noise. Do not replace this with an SVD; it is correct.

Applied via `ctx.setTransform(m00, m10, m01, m11, m02, m12)`.

### 6.3 The simulator

Not a mock. Each identity is a deterministic unit vector in 512-d derived from
a hash of the student id; a capture perturbs it with Gaussian noise of scale σ.

Measured, and asserted in `logic.test.mjs`:

| Property | Measured | Theory |
|---|---|---|
| Impostor mean | -0.0000 | 0 |
| Impostor sd | 0.0441 | 1/√512 = 0.0442 |
| Max impostor over 44,850 pairs | 0.1997 | — |
| Genuine cos at σ=0.030 | 0.827 | 0.827 |
| Genuine cos at σ=0.055 | 0.626 | 0.626 |
| Genuine cos at σ=0.090 | 0.440 | 0.441 |

Relationship: `cos ≈ 1/√(1 + 512σ²)`. The 0.45 accept threshold corresponds to
σ ≈ 0.088. Because the separation geometry matches real ArcFace, thresholds
tuned on the simulator transfer meaningfully.

Two properties that were bugs and are now invariants:

- **Attendance is fixed per session, not per shot.** `SyntheticEngine.attendance()`
  memoises the attending set, cleared only by `setRoster()`. When it was re-rolled
  per shot, the union across three shots included nearly everyone and nobody was
  ever absent.
- **Noise scales with row depth.** `_noise = sigma * (1 + 2.1*(1 - depth))`, so
  back rows degrade. Without this, results were unrealistically uniform.

### 6.4 Matching

`Gallery.forClass(klassId)` loads only that class's active templates. Matching
is never against the whole college.

`Gallery.match(emb, cfg)` takes the best score per student, ranks, and returns
a band:

- `accept` — `top.score >= acceptThreshold` **and** `margin >= marginMin`
- `review` — `top.score >= reviewThreshold`
- `reject` — otherwise
- `toosmall` — set upstream when the detection width `< minFacePx`

Defaults: accept `0.45`, review `0.32`, margin `0.04`, minFacePx `26`,
detScore `0.45`, maxTemplates per student `8`.

`runRecognition()` iterates shots, collapses the same student appearing in
multiple shots to their single best observation, and returns `{faces, decided,
unassigned, stats}`.

Measured behaviour on a 57-student class, 3 shots, default settings:
27 auto-present, 17 to Check, 13 absent, 10 faces unplaced. 400 off-roll faces
produced zero false presents.

### 6.5 Cryptography

- **Passwords**: PBKDF2-SHA256, 210,000 iterations, 16-byte random salt per
  account, 256-bit output. Near-constant-time comparison. **Do not "simplify"
  this to SHA-256** — the original project brief said SHA-256 for passwords and
  that is a weakness, not a feature.
- **TOTP**: RFC 6238, HMAC-SHA1, 30-second step, 6 digits, ±1 window. Both
  published test vectors pass (T=59 → `94287082`, T=1111111109 → `07081804`),
  so codes validate in any standard authenticator.
- **Audit chain**: each entry hashes `prevHash|seq|ts|actor|device|action|JSON(detail)`.
  `Audit.verify()` recomputes the chain and reports the first break.
- **Session seal**: SHA-256 over the session identity plus every row as
  `studentId:state:source:conf(4dp)`, student-id sorted. Tested to detect a
  single flipped mark.

### 6.6 The gate

`gateCheck(user, klassId?)` requires all of: a timetable slot (own, or via an
accepted non-expired substitution) live within `[start - earlyOpenMin,
end + lateGraceMin]`; and the current handset present in `user.deviceIds`.
Failures return human-readable `reasons[]` and `needsOverride`.

Time is read exclusively through `Clock.now()` / `Clock.minutes()` / `Clock.day()`.
**This is the single seam for ERP integration** — substitute server time there
and every consumer follows. Do not introduce bare `Date.now()` for
attendance-affecting logic.

Overrides are permitted, require a typed reason, and write
`gate.override` to the audit log.

### 6.7 The dispute loop

`assignFaceTo(face, student, row)` in `ui.js`. Order of operations matters:

1. Show the crop beside the student's name, with the closest existing score.
2. Warn if the face is below the size floor.
3. Only on confirmation: mark present, write the template with
   `source:'dispute'` and `createdBy`, retire the oldest non-enrol template if
   the cap is reached, log `template.add`.

Templates are soft-deleted (`active: false`), never removed, so corrections are
reversible and attendance already recorded is unaffected.

**Do not add any path that writes a template without the confirmation step.**
This is the guard against gallery poisoning, which is a runtime operator error
that model fine-tuning cannot prevent.

---

## 7. Invariants — breaking these breaks the product

1. Nothing is marked present without clearing both the score threshold and the
   margin. Three outcomes, never two.
2. Detections below `minFacePx` are never auto-matched.
3. Matching is per-class, never college-wide.
4. Every template write is confirmed by a human and is reversible.
5. Attendance-affecting time comes from `Clock`, not `Date.now()`.
6. All interpolated content passes through `esc()`.
7. No network calls. The app must work in airplane mode.
8. The `review` state never survives into stored `attendance`; it becomes
   `absent` + `flagged`.
9. The engine interface is the only place that knows whether inference is real.
10. `localStorage` holds device-local state only and is never exported.

---

## 8. Testing

```bash
npm test          # all three suites, no browser needed
```

`logic.test.mjs` loads sources into a `node:vm` context; `flow.test.mjs` and
`dist.test.mjs` use jsdom with `fake-indexeddb` and `node:crypto.webcrypto`.
Canvas is stubbed — pixel values are never read in simulator mode, so this is
sufficient for everything except real ONNX paths, which are untested
automatically.

Two harness traps, both already handled, both of which cost time when they
first appeared:

- **jsdom does not put `TextEncoder`/`TextDecoder` on its window.** Without
  shims, `core.js` aborts at its first use, every declaration after that point
  is missing, and the failure surfaces far away as "Settings is undefined".
  The harness defines both, and attaches a `VirtualConsole` `jsdomError`
  listener so a script error is reported where it happens instead of being
  swallowed.
- **The global-lexical-scope point from §4.** The bridge script is required;
  do not remove it.

There is a Python reference implementation of the full real pipeline
(`ref_pipeline.py`, not shipped) that was used to validate the ONNX decode
before porting to JS. Measured on a real photograph: detection score 0.808,
`cos(orig, flipped) = 0.948`, `cos(orig, 50% darker) = 0.957`,
`cos(orig, 8× downscaled) = 0.977`. If the JS path is ever suspected of being
wrong, rebuilding that reference in Python with `onnxruntime` and comparing
embeddings on the same image is the fastest way to isolate it.

**Untested**: real ONNX inference in a browser, actual camera capture, visual
layout, the RetinaFace decode path, and Capacitor/Android behaviour.

---

## 9. Known gaps, deliberate and otherwise

**Deliberate**
- No liveness or anti-spoofing. A printed face would work. The teacher taking
  the photo removes the usual attack; this is stated rather than hidden.
- No model fine-tuning. The recogniser is frozen; accuracy depends on enrolment
  quality.
- No ERP integration. Seams marked: `Clock.now()`, the password check in
  `ACTIONS.signin`, `exportAll()`.

**Outstanding**
- Consent, retention and deletion under the DPDP Act 2023 for real student
  data. Fine for a consenting-friends demo; required before deployment.
- Google Workspace SSO.
- No visual/layout verification (no browser in the build environment).
- Real-device performance unmeasured. Expect a few seconds per shot on a
  mid-range handset with the WASM backend, single-threaded (no COOP/COEP
  headers under Capacitor, so `numThreads = 1`).
- `_decodeRetina` written but never executed.

---

## 10. If you are asked to change something

- **New screen** → add `VIEWS.name` in `admin.js`, plus `ACTIONS` entries.
  Return an HTML string from `shell(title, sub, body, actions)`.
- **New stored field** → add to the entity in §5.2, and to `exportAll` /
  `importAll` if it needs special handling (only `templates` does, because
  `Float32Array` does not survive JSON).
- **New engine** → implement `detect` and `embed`, register in `buildEngine`.
  Do not touch `runRecognition` or the UI.
- **Threshold behaviour** → change defaults in `DEFAULTS` in `core.js`, not at
  call sites. Every consumer reads `Settings.cache`.
- **Anything touching attendance correctness** → add a test to
  `flow.test.mjs` first. Three real bugs were caught there that would otherwise
  have surfaced in front of examiners.

Rebuild the single file with `python3 build.py` after any change to `www/`, or
the published/shared copy will be stale.

---

## 11. The team's own framing

Useful to know when advising them.

- Two of four members are doing the work. Deadline pressure is real.
- The original pitch said "RetinaFace + ArcFace" and "SHA-256 and MFA
  authentication grade". Both were adjusted for good reasons (§6.1, §6.5) and
  the README gives them the defence to present.
- They described an ART-like adaptive verification list; that idea is
  implemented as the dispute loop in §6.7, with the safeguards they had not
  yet considered.
- They were dismissive of the data-protection question. The position taken here
  is that a consenting-friends demo is genuinely fine, and that raising the
  DPDP question themselves at the review is a strength rather than an
  admission. Do not re-litigate it unless they ask.
