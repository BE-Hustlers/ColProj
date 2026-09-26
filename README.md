# ColProj

Classroom attendance by face recognition, running entirely on the handset.
No server, no network calls, no accounts held anywhere but the device.

This is the standalone build. It is deliberately self-contained so it can be
demonstrated and evaluated before any decision is taken about wiring it into
the college ERP.

**Documentation**

| File | For |
|---|---|
| `README.md` | Building, deploying, and the decisions to defend at a review |
| `docs/MANUAL.md` | Complete user manual, screen by screen, plus a demo script |
| `docs/CONTEXT.md` | Architecture and handoff notes — paste into a fresh AI session |
| `docs/SESSION-2026-09-26.md` | What was built, what was decided, and why |

---

## Run it in 30 seconds

```bash
npm start            # serves www/ on http://localhost:8080
```

Open it on a phone on the same Wi-Fi at `http://<your-laptop-ip>:8080`.

> Camera access needs a secure context. `localhost` counts as secure; a plain
> `http://192.168.x.x` does not, so the camera will be blocked there. Either use
> the APK, or tunnel it over HTTPS, or use the "photos from the gallery" button,
> which works everywhere.

Sign in as any seeded account with the password `colproj`.
`Prof. V. D. Sawant` is the walkthrough teacher — the seed guarantees they
always have a class open right now, so a demo never lands on "nothing scheduled".

---

## Getting the APK onto a phone

There is no build pipeline. The APK is produced on your machine and the file
lands on disk. Nothing here runs on a server.

### Before you start

Install **Android Studio**, which brings the Android SDK and Gradle with it.

Budget real time for this. First launch downloads several GB, and the first
Gradle build after that pulls dependencies for another ten to twenty minutes.
Do it the night before you need it, on decent internet — not an hour before a
demo.

### Build it

```bash
npm install
npx cap add android        # once; generates the android/ Gradle project
```

Then one manual edit, in `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

Now either route works:

```bash
npm run android:open       # Android Studio -> Build -> Build Bundle(s)/APK(s) -> Build APK(s)
```

or skip the IDE entirely:

```bash
cd android && ./gradlew assembleDebug
```

### Where the file is

```
android/app/build/outputs/apk/debug/app-debug.apk
```

That is the file you copy to a phone.

It is signed with Android's debug key, which installs and runs normally and is
fine for a project review. A release build with your own keystore is only
needed for the Play Store.

### Onto the handset

- **USB cable:** `adb install app-debug.apk` — the reliable route.
- **Google Drive:** upload, download on the phone, tap to install.
- **Not WhatsApp.** It blocks `.apk` attachments.

Either way the phone needs *install from unknown sources* enabled for whichever
app is doing the installing.

### After any change to `www/`

```bash
npm run android:sync       # runs build.py, then cap sync
```

then build the APK again. `sync` copies `www/` into the Android project. Skip
it and you rebuild the old code and wonder why your fix did nothing.

### Two things that will bite you

**`android/` is gitignored.** It is regenerable, which also makes it
disposable. If anyone deletes it and re-runs `cap add android`, the
`CAMERA` permission edit is gone and the camera silently stops working with no
error message. Tell your teammates.

**CI is not worth it before the review.** A GitHub Actions workflow could build
this and hand you a downloadable artifact — `setup-java`, `cap sync`,
`assembleDebug`, `upload-artifact`, about fifteen lines. But it needs `android/`
committed or regenerated in the job, each run takes minutes, and you end up
debugging CI instead of your demo. Build locally now; automate later if the
project continues.

### Notes

Capacitor serves the app from `https://localhost` inside the WebView, so
`getUserMedia`, IndexedDB and WebCrypto all work, and everything stays offline.

Installed size is about 27 MB, most of it the two model files and the
onnxruntime WASM binary.

Inference runs single-threaded (no COOP/COEP headers under Capacitor), so
expect a few seconds per shot on a mid-range handset. Time it before the demo.
If it is genuinely slow, dropping the detector input from 640 to 512 in
`DETECTORS.scrfd` is the first lever.

---

## How it is put together

```
www/
  index.html            boot sequence
  css/app.css           one stylesheet, no framework
  js/core.js            IndexedDB store, WebCrypto, roles, timetable gate, seed data
  js/engine.js          detection, alignment, embedding, matching
  js/ui.js              shell, router, sign-in, capture, review
  js/admin.js           roster, enrolment, staff, workflows, testing, integrity
  js/ort.wasm.min.js    onnxruntime-web 1.19.2 (WASM backend only)
  js/*.wasm             its runtime
  models/
    det_500m.onnx       SCRFD-500M detector,  2.5 MB
    w600k_mbf.onnx      ArcFace MobileFaceNet, 13.6 MB, 512-d
build.py                collapses www/ into one shareable HTML file
test/                   79 tests, no browser needed
```

No build step is required to develop. The files load as plain `<script>` tags in
dependency order. `build.py` exists only to produce the single-file version.

### The three engines

Everything downstream of `detect()` and `embed()` is engine-agnostic.

| Engine | What it is | When it runs |
|---|---|---|
| `onnx` | Real SCRFD + ArcFace | Whenever the weight files are present |
| `synthetic` | Simulator, no weights | Fallback, and for threshold work |
| `fixture` | Replays a recorded run | Repeatable UAT |

The app probes for the weight files at boot and picks automatically; the
Testing screen overrides it. The same build therefore demonstrates on a laptop
with no models, on a phone with models, and inside the APK, with no code
branching anywhere except the engine itself.

**The simulator is not a mock.** Each student gets a deterministic 512-d unit
vector as their true identity, and a capture perturbs it with Gaussian noise.
Measured over 300 identities, impostor pairs sit at `0.0000 ± 0.0441` against a
theoretical `1/sqrt(512) = 0.0442`, and noise `sigma` produces
`cos ~ 1/sqrt(1 + 512*sigma^2)` to within 0.02. The separation geometry is the
same as real ArcFace, so a threshold tuned on the simulator transfers.

---

## Decisions worth defending at a review

### The detector is SCRFD, not RetinaFace

Every public RetinaFace weight file is hosted on Google Drive, and the ResNet50
variant is over 100 MB — not shippable in a phone app. SCRFD is by the same
InsightFace authors, is RetinaFace's direct successor, and beats it on WIDER
FACE at a fraction of the compute. At 2.5 MB it is mobile-viable.

The decoder is pluggable and the full RetinaFace prior-box path is implemented
in `engine.js` (`_decodeRetina`). Drop `retinaface_mnet025.onnx` into `models/`
and change `detector: 'retinaface'` to switch. Nothing else moves.

The honest framing: *we evaluated RetinaFace and selected its successor for
mobile viability.* That is a stronger position than the original claim.

### Three outcomes, not two

A face is marked present only when it clears the accept threshold **and** beats
the runner-up identity by a margin. Everything else goes to **Check** for the
teacher, and is saved as absent-but-flagged if left unresolved.

This is deliberate. A student wrongly marked absent is corrected in ten seconds.
A student wrongly marked present is undetectable fraud. The thresholds are tuned
to err high, and the Testing screen runs a live sweep so the trade-off can be
shown rather than asserted.

Default accept threshold is 0.45, which corresponds to roughly `sigma = 0.088`
of capture degradation. In testing, 400 off-roll faces produced zero false
presents.

### Faces below a size floor are never guessed at

`minFacePx` defaults to 26. Smaller detections are reported and shown, but never
auto-matched — they go straight to the unplaced strip. This is why the capture
screen pushes column-by-column shooting: one wide photo of a 60-seat room leaves
back-row faces at 20–40 px, which is below the point where embeddings separate
reliably.

### The dispute loop cannot silently poison the gallery

When a teacher attributes an unplaced face to a student, two things happen
before anything is written:

1. The crop is shown next to the student's name and the teacher confirms.
2. The addition is stamped with who approved it, when, and in which session.

Every learned face is individually removable from the student's page, and the
attendance already recorded is unaffected by removing it. Per-student templates
are capped (default 8); the oldest learned template retires first, and enrolment
templates are never evicted.

Fine-tuning the model does not address this. Poisoning is a runtime operator
error, not a model quality problem.

### Cryptography

- **Passwords**: PBKDF2-SHA256, 210,000 iterations, per-account random salt.
  A bare SHA-256 digest is GPU-brute-forceable at billions of guesses per
  second; the iteration count is the entire point. Do not claim "SHA-256 password
  hashing" at a review — it is a weakness, not a feature.
- **Two-step verification**: real RFC 6238 TOTP, HMAC-SHA1, 30-second step.
  Both published test vectors pass, so the codes validate in Google
  Authenticator or Aegis.
- **SHA-256** is used where a digest belongs: a hash-chained audit log where
  each entry covers the previous hash, and a per-roll seal over the full
  attendance record. Editing any past entry breaks every hash after it. The
  Record integrity screen re-derives both and reports a break.

### The timetable tether

A class roster unseals only when teacher identity, a registered handset, and the
clock all agree with a scheduled slot. Time is read through a single `Clock`
object rather than `Date.now()` scattered through the code, so the ERP build
substitutes server time in one place.

Opening a class outside the timetable is possible, requires a typed reason, and
is written to the audit log against the teacher's name and handset.

---

## Things that are explicitly not done

- **Spoofing / liveness.** Out of scope, by decision. The teacher takes the
  photo, which removes the usual attack. A printed face on a stick would work.
  Say so rather than being caught out.
- **ERP integration.** The seams are marked: `Clock.now()` for server time, the
  password check in `ACTIONS.signin` for Google Workspace SSO, and `exportAll()`
  for the record push.
- **Fine-tuning.** The recogniser is frozen. Accuracy depends almost entirely on
  enrolment quality — aim for 4–5 images per student with real variation in
  lighting and angle, not five frames of the same pose.
- **Consent and retention.** Face templates are personal data under the DPDP Act
  2023. For a demo with friends who have agreed, this is fine. Before it touches
  real students, the college needs a consent flow, a retention policy and a
  deletion path. Raising this yourself at the review reads as thoroughness.

---

## What to commit

Commit everything except generated output and anything derived from real people.

| Path | Commit? | Why |
|---|---|---|
| `www/` (all source) | yes | The application |
| `www/models/*.onnx` | yes | 16 MB of binaries, but the project does not build without them |
| `www/js/ort*.{js,wasm,mjs}` | yes | Same reason — vendored so the app works offline |
| `test/`, `build.py`, `docs/`, `README.md` | yes | |
| `package.json`, `capacitor.config.json`, `.gitignore` | yes | |
| `package-lock.json` | yes | Pins versions for your teammates |
| `dist/` | **no** | Generated by `build.py` in a second |
| `android/` | **no** | Generated by `cap add android` |
| `node_modules/` | **no** | |
| Exported JSON, student photos | **never** | See below |

**On the model files.** 16 MB of binaries is under GitHub's limits and fine for
a project of this length. Git LFS is the textbook answer but is one more thing
to break on a teammate's machine the night before a deadline, and a download
script means your project stops building if the release URL moves. Commit them.

**On `dist/colproj.html`.** Do not commit it. Someone edits `www/`, forgets to
rebuild, and the repo now contains a file that quietly disagrees with the
source. If you want a live demo link, put it on a `gh-pages` branch or attach
it to a release tag, not on `main`.

**Never commit:** real student photographs, or any JSON produced by
*Export everything*. That export contains a face descriptor for every enrolled
person. It is not a photograph and cannot be turned back into one, but it is
still biometric-derived personal data and a public repository is the wrong
place for it. The export button makes it easy to drop one into the project
folder without thinking, so the `.gitignore` covers it — check that it still
does before your first push.

---

## Tests

```bash
npm test
```

79 tests, three suites, no browser required.

- `logic.test.mjs` — alignment geometry against Umeyama, simulator statistics
  against theory, matcher band behaviour, RFC 6238 vectors, PBKDF2.
- `flow.test.mjs` — boots the real application under jsdom and drives it:
  sign in, role scoping, timetable gate, capture, analyse, correct a face,
  save, verify the seal, tamper with the audit log and detect it, render
  every view.
- `dist.test.mjs` — boots the built single-file artefact and signs in.

Three real bugs were found this way and fixed: the simulator re-rolled
attendance per shot so nobody was ever absent, capture noise ignored row depth,
and the analysis step crashed if the view changed while it was running.
