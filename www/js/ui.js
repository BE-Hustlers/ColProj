/* ColProj interface — shell, routing, sign-in, capture, review. */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const App = {
  user: null,
  engine: null,
  engineStatus: 'not started',
  stack: [],
  session: null,      // live capture session
  view: null,
  params: {},
};

/* ---------------------------------------------------------
   Shell primitives
   --------------------------------------------------------- */

const root = () => document.getElementById('app');

function toast(msg, ms = 2600) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function sheet(html, onMount) {
  closeSheet();
  const s = document.createElement('div');
  s.className = 'scrim';
  s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grab"></div>${html}</div>`;
  s.addEventListener('click', e => { if (e.target === s) closeSheet(); });
  document.body.appendChild(s);
  if (onMount) onMount(s.querySelector('.sheet'));
  const f = s.querySelector('input,select,textarea,button');
  if (f) setTimeout(() => f.focus(), 40);
  return s;
}
const closeSheet = () => document.querySelectorAll('.scrim').forEach(s => s.remove());

function confirmSheet(title, body, okLabel = 'Confirm', danger = false) {
  return new Promise(res => {
    sheet(`<h2>${esc(title)}</h2><div>${body}</div>
      <div class="row"><button class="btn ghost" data-x="no">Cancel</button>
      <button class="btn ${danger ? 'danger' : ''}" data-x="yes">${esc(okLabel)}</button></div>`,
      el => {
        el.querySelector('[data-x=no]').onclick = () => { closeSheet(); res(false); };
        el.querySelector('[data-x=yes]').onclick = () => { closeSheet(); res(true); };
      });
  });
}

function go(view, params = {}, replace = false) {
  if (!replace && App.view) App.stack.push({ view: App.view, params: App.params });
  App.view = view; App.params = params;
  render();
}
function back() {
  const prev = App.stack.pop();
  if (prev) { App.view = prev.view; App.params = prev.params; render(); }
  else go('home', {}, true);
}

const VIEWS = {};   // filled by this file and admin.js

async function render() {
  const fn = VIEWS[App.view] || VIEWS.home;
  const r = root();
  r.setAttribute('aria-busy', 'true');
  try {
    const out = await fn(App.params);
    r.innerHTML = out;
    r.removeAttribute('aria-busy');
    const mount = VIEWS[App.view + ':mount'];
    if (mount) await mount(App.params);
    wire(r);
    r.querySelector('main')?.scrollTo?.(0, 0);
    Coach.maybeShow(App.view);
  } catch (e) {
    console.error(e);
    r.innerHTML = shell('Something went wrong', '',
      `<div class="view"><div class="panel"><h3>Unhandled error</h3>
       <p class="note bad">${esc(e.message)}</p>
       <button class="btn ghost" data-act="home">Back to start</button></div></div>`);
    wire(r);
  }
}

/* Delegated actions keep the markup declarative. */
const ACTIONS = {};
function wire(scope) {
  scope.querySelectorAll('[data-act]').forEach(n => {
    if (n._wired) return;
    n._wired = true;
    n.addEventListener('click', ev => {
      const fn = ACTIONS[n.dataset.act];
      if (fn) { ev.preventDefault(); fn(n.dataset, n, ev); }
    });
  });
}
ACTIONS.back = () => back();
ACTIONS.home = () => { App.stack = []; go('home', {}, true); };
ACTIONS.goto = d => go(d.to, d.arg ? JSON.parse(d.arg) : {});

function shell(title, sub, body, actions = '', showBack = true) {
  return `
    <div class="topbar">
      ${showBack ? '<button class="back" data-act="back" aria-label="Back">&#8249;</button>' : ''}
      <div class="topbar-txt"><strong>${esc(title)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}</div>
    </div>
    <main>${body}</main>
    ${actions ? `<div class="actionbar">${actions}</div>` : ''}`;
}

const stateChip = s => s === 'present' ? '<span class="chip p">Present</span>'
  : s === 'absent' ? '<span class="chip a">Absent</span>'
  : s === 'review' ? '<span class="chip r">Check</span>'
  : '<span class="chip n">Not marked</span>';

/* ---------------------------------------------------------
   Guided walkthrough
   --------------------------------------------------------- */

const Coach = {
  steps: {
    home: [{ sel: '[data-coach=take]', title: 'Start here',
             body: 'Taking attendance is the one thing this screen is for. Your timetable decides which class opens — you never pick it from a list.' },
           { sel: '[data-coach=engine]', title: 'What is doing the recognising',
             body: 'Real models when the weight files are present, simulator otherwise. Tap it any time to see which is running.' }],
    capture: [{ sel: '[data-coach=stage]', title: 'Shoot column by column',
                body: 'One wide photo leaves back-row faces too small to identify. Three overlapping shots across the room give every face enough pixels.' },
              { sel: '[data-coach=shutter]', title: 'Take each shot',
                body: 'Aim at the highlighted column, then tap. Retake any shot you are not happy with before you analyse.' }],
    review: [{ sel: '[data-coach=tally]', title: 'Three outcomes, not two',
               body: 'Anything the system is not confident about lands in Check rather than being guessed. That is deliberate.' },
             { sel: '[data-coach=faces]', title: 'Faces it could not place',
               body: 'Tap a face, then tap the student it belongs to. Confirming teaches the system that face for next time.' }],
  },
  seen: JSON.parse(localStorage.getItem('colproj.coach') || '{}'),
  active: localStorage.getItem('colproj.coach.on') !== '0',
  queue: [], i: 0,

  maybeShow(view) {
    this.clear();
    if (!this.active) return;
    const steps = (this.steps[view] || []).filter(s => !this.seen[view + '|' + s.title]);
    if (!steps.length) return;
    this.queue = steps; this.i = 0; this.view = view;
    setTimeout(() => this.show(), 260);
  },
  clear() { document.querySelectorAll('.coach').forEach(c => c.remove()); },
  show() {
    this.clear();
    const step = this.queue[this.i];
    if (!step) return;
    const target = document.querySelector(step.sel);
    if (!target) { this.next(); return; }
    const r = target.getBoundingClientRect();
    const below = r.bottom + 190 < window.innerHeight;
    const c = document.createElement('div');
    c.className = 'coach';
    c.innerHTML = `
      <div class="cut" style="top:${r.top - 5}px;left:${r.left - 5}px;width:${r.width + 10}px;height:${r.height + 10}px"></div>
      <div class="bubble" style="${below ? `top:${r.bottom + 14}px` : `bottom:${window.innerHeight - r.top + 14}px`}">
        <h3>${esc(step.title)}</h3><p>${esc(step.body)}</p>
        <footer><span class="step">${this.i + 1} of ${this.queue.length}</span>
          <button class="btn quiet sm" data-c="skip">Skip tips</button>
          <button class="btn sm" data-c="next">${this.i + 1 === this.queue.length ? 'Got it' : 'Next'}</button>
        </footer>
      </div>`;
    document.body.appendChild(c);
    c.querySelector('[data-c=next]').onclick = () => this.next();
    c.querySelector('[data-c=skip]').onclick = () => this.off();
  },
  next() {
    const s = this.queue[this.i];
    if (s) { this.seen[this.view + '|' + s.title] = 1; localStorage.setItem('colproj.coach', JSON.stringify(this.seen)); }
    this.i++;
    if (this.i < this.queue.length) this.show(); else this.clear();
  },
  off() { this.active = false; localStorage.setItem('colproj.coach.on', '0'); this.clear(); toast('Tips switched off. Turn them back on in Settings.'); },
  reset() {
    this.seen = {}; this.active = true;
    localStorage.setItem('colproj.coach', '{}'); localStorage.setItem('colproj.coach.on', '1');
    toast('Tips reset.');
  },
};

/* ---------------------------------------------------------
   Engine bootstrap
   --------------------------------------------------------- */

async function ensureEngine(force = false) {
  if (App.engine && !force) return App.engine;
  const pref = Settings.get('engine');
  App.engineStatus = 'starting';
  App.engine = await buildEngine(pref, {
    base: './models/',
    sigma: Settings.get('simSigma') ?? 0.055,
    presentRate: Settings.get('simPresentRate') ?? 0.86,
    strangerCount: Settings.get('simStrangers') ?? 1,
    seed: Settings.get('simSeed') ?? 1,
    onProgress: m => { App.engineStatus = m; },
  });
  App.engineStatus = 'ready';
  return App.engine;
}

/* ---------------------------------------------------------
   Sign in
   --------------------------------------------------------- */

VIEWS.login = async () => {
  const users = await DB.all('users');
  const byRole = ['admin', 'vice', 'hod', 'teacher'];
  users.sort((a, b) => byRole.indexOf(a.role) - byRole.indexOf(b.role));
  const opts = users.filter(u => u.active).map(u =>
    `<option value="${esc(u.id)}">${esc(u.name)} — ${esc(ROLES[u.role].label)}</option>`).join('');
  return `<div class="view login">
    <div class="mark">ColProj</div>
    <div class="sub">Classroom attendance by face, on the handset.</div>
    <div class="stack">
      <label class="fld"><span>College account</span><select id="who">${opts}</select></label>
      <label class="fld"><span>Password</span><input type="password" id="pw" value="colproj" autocomplete="current-password"></label>
      <button class="btn go" data-act="signin">Sign in</button>
      <p class="note">Seeded accounts all use <b>colproj</b>. Real deployment authenticates against the
      college Google Workspace; that swap happens in one function.</p>
    </div>
    <div class="rule"></div>
    <dl class="kv">
      <dt>This handset</dt><dd>${esc(Device.label())}</dd>
      <dt>Recognition</dt><dd id="engline">checking…</dd>
    </dl>
  </div>`;
};

VIEWS['login:mount'] = async () => {
  const line = document.getElementById('engline');
  const has = typeof ort !== 'undefined' && await modelsPresent('./models/');
  line.textContent = has ? 'SCRFD + ArcFace weights found' : 'Simulator (no weight files present)';
};

ACTIONS.signin = async () => {
  const id = document.getElementById('who').value;
  const pw = document.getElementById('pw').value;
  const u = await DB.get('users', id);
  if (!u || !(await Crypto2.verifyPassword(pw, u.pw))) {
    await Audit.log(id, 'signin.fail', {});
    return toast('That password does not match.');
  }
  if (u.mfaEnabled && u.totpSecret) return askMfa(u);
  await completeSignin(u);
};

function askMfa(u) {
  sheet(`<h2>Two-step verification</h2>
    <p class="note">Enter the current 6-digit code from your authenticator app.</p>
    <label class="fld"><span>Code</span><input id="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label>
    <div class="row"><button class="btn ghost" data-x="cancel">Cancel</button>
    <button class="btn" data-x="ok">Verify</button></div>`, el => {
    el.querySelector('[data-x=cancel]').onclick = closeSheet;
    el.querySelector('[data-x=ok]').onclick = async () => {
      const code = el.querySelector('#otp').value;
      if (await Crypto2.totpVerify(u.totpSecret, code)) { closeSheet(); await completeSignin(u); }
      else { await Audit.log(u.id, 'mfa.fail', {}); toast('That code is not valid right now.'); }
    };
  });
}

async function completeSignin(u) {
  App.user = u;
  App.stack = [];
  if (!u.deviceIds.includes(Device.id())) {
    u.deviceIds = [...u.deviceIds, Device.id()];
    await DB.put('users', u);
    await Audit.log(u.id, 'device.register', { device: Device.id() });
  }
  await Audit.log(u.id, 'signin', { role: u.role });
  await ensureEngine();
  go('home', {}, true);
}

ACTIONS.signout = async () => {
  await Audit.log(App.user?.id, 'signout', {});
  App.user = null; App.stack = [];
  go('login', {}, true);
};

/* ---------------------------------------------------------
   Home
   --------------------------------------------------------- */

VIEWS.home = async () => {
  const u = App.user;
  if (!u) return VIEWS.login();
  const gate = await gateCheck(u);
  const klasses = await scopedKlasses(u);
  const today = todayISO();
  const mine = await DB.where('sessions', s => s.date === today &&
    (ROLES[u.role].rank >= 2 ? true : s.teacherId === u.id));
  const pending = await DB.where('requests', r => r.status === 'pending' && r.to === u.id);
  const engineName = App.engine ? App.engine.name : 'starting…';
  const isSim = App.engine && App.engine.id !== 'onnx';

  let gateBlock;
  if (gate.ok && gate.slot) {
    const k = await DB.get('klasses', gate.slot.klassId);
    const { total, enrolled } = await enrolledCount(gate.slot.klassId);
    gateBlock = `<div class="panel" data-coach="take">
      <h3>On now${gate.viaSubstitution ? ' — you are covering this class' : ''}</h3>
      <p style="margin:.2rem 0 .1rem"><b>${esc(k.name)}</b></p>
      <p class="note">${esc(gate.slot.subject)} · ${esc(fmtTime(gate.slot.start))}–${esc(fmtTime(gate.slot.end))}
         · ${enrolled} of ${total} students have a face on file</p>
      <div class="row" style="margin-top:.7rem">
        <button class="btn go" data-act="startcapture" data-slot="${esc(gate.slot.id)}" data-klass="${esc(gate.slot.klassId)}">Take attendance</button>
      </div>
      ${enrolled === 0 ? `<p class="note warn" style="margin-top:.6rem">No faces enrolled for this class yet —
        recognition will find nobody. Enrol from the class page, or mark by hand.</p>` : ''}
    </div>`;
  } else {
    gateBlock = `<div class="panel" data-coach="take">
      <h3>No class open right now</h3>
      ${gate.reasons.map(r => `<p class="note">${esc(r)}</p>`).join('')}
      <div class="row" style="margin-top:.7rem">
        ${Can.overrideGate(u) || gate.needsOverride
          ? `<button class="btn ghost" data-act="overridegate">Open a class anyway</button>` : ''}
      </div>
    </div>`;
  }

  const links = [
    ['Classes', 'classes', `${klasses.length} in your scope`],
    ['Timetable', 'timetable', 'When you teach what'],
    ...(Can.createTeacher(u) ? [['People', 'people', 'Accounts and permissions']] : []),
    ['Requests', 'requests', pending.length ? `${pending.length} waiting on you` : 'Cover and transfers'],
    ['Attendance history', 'history', `${mine.length} session(s) today`],
    ...(Can.uat(u) ? [['Testing & settings', 'uat', 'Engine, thresholds, data']] : []),
    ['Record integrity', 'audit', 'Tamper check'],
  ];

  return shell(u.name, `${ROLES[u.role].label}${u.deptId ? ' · ' + (await DB.get('depts', u.deptId)).name : ''}`,
    `<div class="view">
      ${gateBlock}
      <div class="panel" data-coach="engine">
        <h3>Recognition</h3>
        <p class="note">${esc(engineName)}${App.engine?.detail ? ' · ' + esc(App.engine.detail) : ''}</p>
        ${isSim ? `<p class="note warn">Running on the simulator. Put <code>det_500m.onnx</code> and
          <code>w600k_mbf.onnx</code> in <code>models/</code> to use the real thing.</p>` : ''}
      </div>
      <div class="ledger">
        ${links.map(([t, v, s]) => `<button class="lrow" role="button" data-act="goto" data-to="${v}">
          <span class="who"><b>${esc(t)}</b><small>${esc(s)}</small></span>
          <span class="end"><span class="chip n">Open</span></span></button>`).join('')}
      </div>
      <button class="btn ghost" data-act="signout">Sign out</button>
    </div>`, '', false);
};

ACTIONS.overridegate = async () => {
  const u = App.user;
  const klasses = await scopedKlasses(u);
  const all = klasses.length ? klasses : await DB.all('klasses');
  sheet(`<h2>Open a class outside your timetable</h2>
    <p class="note">This is logged against your name and this handset, with the reason you give.</p>
    <label class="fld"><span>Class</span><select id="k">${all.map(k =>
      `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('')}</select></label>
    <label class="fld"><span>Reason</span><input id="why" placeholder="Covering for Prof. Nikam"></label>
    <div class="row"><button class="btn ghost" data-x="c">Cancel</button>
    <button class="btn" data-x="ok">Open class</button></div>`, el => {
    el.querySelector('[data-x=c]').onclick = closeSheet;
    el.querySelector('[data-x=ok]').onclick = async () => {
      const kid = el.querySelector('#k').value;
      const why = el.querySelector('#why').value.trim();
      if (!why) return toast('A reason is required for an out-of-timetable session.');
      await Audit.log(u.id, 'gate.override', { klassId: kid, reason: why });
      closeSheet();
      startCapture(kid, null, why);
    };
  });
};

ACTIONS.startcapture = d => startCapture(d.klass, d.slot, null);

/* ---------------------------------------------------------
   Capture
   --------------------------------------------------------- */

async function startCapture(klassId, slotId, overrideReason) {
  const k = await DB.get('klasses', klassId);
  App.session = {
    id: uid('ses'), klassId, teacherId: App.user.id, slotId: slotId || null,
    date: todayISO(), startedAt: Date.now(), deviceId: Device.id(),
    overrideReason: overrideReason || null,
    shots: [], columns: Settings.get('columns') ?? 3, klassName: k.name,
    status: 'capturing',
  };
  go('capture', { klassId });
}

VIEWS.capture = async () => {
  const s = App.session;
  if (!s) return VIEWS.home();
  return shell('Take attendance', s.klassName, `
    <div class="view">
      <div class="stage" id="stage" data-coach="stage">
        <video id="cam" playsinline muted autoplay></video>
        <div class="guides" id="guides"></div>
        <div class="badge" id="badge">Column 1 of ${s.columns}</div>
      </div>
      <p class="note" id="camnote">Aim at the highlighted column and tap the shutter. Overlapping shots are fine.</p>
      <div class="shots" id="shots"></div>
      <div class="row">
        <button class="btn ghost sm" data-act="pickfiles">Use photos from the gallery</button>
        <button class="btn ghost sm" data-act="flipcam">Switch camera</button>
      </div>
      <input type="file" id="filein" accept="image/*" multiple hidden>
    </div>`,
    `<button class="btn ghost" data-act="markbyhand">Mark by hand</button>
     <button class="btn go" data-act="shutter" data-coach="shutter">Take shot</button>
     <button class="btn" data-act="analyse" id="goBtn" disabled>Analyse</button>`);
};

let _stream = null, _facing = 'environment';

VIEWS['capture:mount'] = async () => {
  drawGuides();
  renderShots();
  await openCam();
};

function drawGuides() {
  const g = document.getElementById('guides');
  if (!g) return;
  const n = App.session.columns;
  const cur = App.session.shots.length;
  g.innerHTML = Array.from({ length: n }, (_, i) =>
    `<i class="${i === Math.min(cur, n - 1) ? 'on' : ''}"></i>`).join('');
  const b = document.getElementById('badge');
  if (b) b.textContent = cur >= n ? `${cur} shots taken` : `Column ${cur + 1} of ${n}`;
}

async function openCam() {
  const v = document.getElementById('cam');
  if (!v) return;
  try {
    if (_stream) _stream.getTracks().forEach(t => t.stop());
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: _facing, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
    v.srcObject = _stream;
  } catch (e) {
    document.getElementById('camnote').innerHTML =
      `<span class="note warn">No camera available here (${esc(e.name)}). Use “photos from the gallery” instead.</span>`;
    v.style.display = 'none';
  }
}
function closeCam() { if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; } }

ACTIONS.flipcam = async () => { _facing = _facing === 'environment' ? 'user' : 'environment'; await openCam(); };

ACTIONS.shutter = async () => {
  const v = document.getElementById('cam');
  if (!v || !v.videoWidth) return toast('Camera is not ready. Use gallery photos instead.');
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  addShot(c);
};

ACTIONS.pickfiles = () => document.getElementById('filein').click();

function addShot(canvas) {
  App.session.shots.push({ canvas, thumb: canvas.toDataURL('image/jpeg', 0.55) });
  renderShots(); drawGuides();
  const b = document.getElementById('goBtn');
  if (b) b.disabled = App.session.shots.length === 0;
}

function renderShots() {
  const el = document.getElementById('shots');
  if (!el) return;
  el.innerHTML = App.session.shots.map((s, i) =>
    `<img src="${s.thumb}" alt="Shot ${i + 1}" data-act="dropshot" data-i="${i}" title="Tap to remove">`).join('')
    + `<button class="add" data-act="pickfiles" aria-label="Add photo">+</button>`;
  wire(el);
}
ACTIONS.dropshot = d => { App.session.shots.splice(+d.i, 1); renderShots(); drawGuides();
  const b = document.getElementById('goBtn'); if (b) b.disabled = !App.session.shots.length; };

document.addEventListener('change', async e => {
  if (e.target.id !== 'filein') return;
  for (const f of e.target.files) {
    const img = await createImageBitmap(f);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    addShot(c);
  }
  e.target.value = '';
});

ACTIONS.markbyhand = async () => {
  closeCam();
  const roster = await rosterOf(App.session.klassId);
  App.session.result = {
    rows: roster.map(s => ({ studentId: s.id, state: 'absent', conf: null, source: 'manual', crop: null })),
    unassigned: [], stats: { detected: 0, accepted: 0, review: 0, unmatched: 0, tooSmall: 0 }, manual: true,
  };
  go('review', {}, true);
};

ACTIONS.analyse = async () => {
  const s = App.session;
  if (!s.shots.length) return toast('Take at least one shot first.');
  const stage = document.getElementById('stage');
  const noteEl = document.getElementById('camnote');
  // The view can change under a long-running analysis, so never assume these exist.
  const say = msg => { if (noteEl) noteEl.textContent = msg; };
  stage?.classList.add('scanning');
  const cfg = Settings.cache;

  try {
    const engine = await ensureEngine();
    if (engine.setRoster) engine.setRoster(await rosterOf(s.klassId));
    const gallery = await Gallery.forClass(s.klassId);
    if (gallery.size === 0 && engine.id === 'synthetic') {
      // simulator with nobody enrolled: enrol everyone on the fly so the flow is demonstrable
      await autoEnrolSynthetic(s.klassId, engine);
    }
    const g2 = gallery.size ? gallery : await Gallery.forClass(s.klassId);

    const out = await runRecognition(engine, s.shots.map(x => x.canvas), g2, cfg, st => {
      say(st.phase === 'detect' ? `Finding faces in shot ${st.shot + 1} of ${st.total}…`
        : st.phase === 'embed' ? `Reading ${st.faces} face(s)…`
        : `Matching against ${g2.people} enrolled students…`);
    });

    const roster = await rosterOf(s.klassId);
    s.result = {
      rows: roster.map(st => {
        const d = out.decided.get(st.id);
        return d ? { ...d, source: 'auto' }
                 : { studentId: st.id, state: 'absent', conf: null, source: 'auto', crop: null };
      }),
      unassigned: out.unassigned.map((f, i) => ({
        i, crop: f.crop, width: Math.round(f.width), tooSmall: f.tooSmall,
        emb: f.emb ? Array.from(f.emb) : null,
        best: f.result.top ? { studentId: f.result.top.studentId, score: f.result.top.score } : null,
      })),
      stats: out.stats,
    };
    s.engineUsed = engine.id;
    closeCam();
    go('review', {}, true);
  } catch (e) {
    console.error(e);
    stage?.classList.remove('scanning');
    if (noteEl) noteEl.innerHTML = `<span class="note bad">Analysis failed: ${esc(e.message)}</span>`;
    else toast('Analysis failed: ' + e.message);
  }
};

/* In simulator mode every student needs a stored identity to match against. */
async function autoEnrolSynthetic(klassId, engine) {
  const roster = await rosterOf(klassId);
  const rows = roster.map(s => ({
    id: uid('tpl'), studentId: s.id, active: true, source: 'enrol',
    emb: engine.enrolVector(s.id).buffer, chip: null,
    createdAt: Date.now(), createdBy: 'simulator',
  }));
  await DB.putAll('templates', rows);
  await Audit.log(App.user?.id, 'enrol.simulated', { klassId, count: rows.length });
}

/* ---------------------------------------------------------
   Review
   --------------------------------------------------------- */

let _selFace = null;

VIEWS.review = async () => {
  const s = App.session;
  if (!s || !s.result) return VIEWS.home();
  const roster = await rosterOf(s.klassId);
  const byId = Object.fromEntries(roster.map(r => [r.id, r]));
  const rows = s.result.rows;
  const n = { p: 0, a: 0, r: 0 };
  rows.forEach(r => { n[r.state === 'present' ? 'p' : r.state === 'review' ? 'r' : 'a']++; });

  const faces = s.result.unassigned.filter(f => !f.assigned);
  const facesBlock = faces.length ? `
    <div class="panel" data-coach="faces">
      <h3>${faces.length} face${faces.length > 1 ? 's' : ''} not placed</h3>
      <p class="note">Tap a face, then tap the student it belongs to. Faces under
        ${Settings.get('minFacePx')}px are never guessed at.</p>
      <div class="faces" id="faces">
        ${faces.map(f => `<button data-act="selface" data-i="${f.i}" class="${_selFace === f.i ? 'sel' : ''}"
           title="${f.width}px wide${f.tooSmall ? ' — too small to identify' : ''}">
           <img src="${f.crop}" alt="Unidentified face, ${f.width} pixels wide"></button>`).join('')}
      </div>
      ${_selFace !== null ? '<p class="note warn">Now tap the student this face belongs to.</p>' : ''}
    </div>` : '';

  return shell('Check the roll', `${s.klassName} · ${DAYS[Clock.day()]} ${minToHHMM(Clock.minutes())}`, `
    <div class="view">
      <div class="tally" data-coach="tally">
        <div class="p"><b>${n.p}</b><span>Present</span></div>
        <div class="r"><b>${n.r}</b><span>Check</span></div>
        <div class="a"><b>${n.a}</b><span>Absent</span></div>
      </div>
      ${s.result.manual ? '<p class="note">Manual roll. Tap a name to mark them present.</p>'
        : `<p class="note">${s.result.stats.detected} face(s) found across ${s.shots.length} shot(s)
           · ${s.result.stats.tooSmall} too small to use
           · engine: ${esc(s.engineUsed || '—')}</p>`}
      ${facesBlock}
    </div>
    <div class="ledger-head"><span class="g">Roll</span><span class="n">Student</span><span>Status</span></div>
    <div class="ledger" id="roll">
      ${rows.map(r => {
        const st = byId[r.studentId]; if (!st) return '';
        const cls = r.state === 'present' ? 's-p' : r.state === 'review' ? 's-r' : 's-a';
        return `<button class="lrow ${cls} ${r.source !== 'auto' ? 'edited' : ''}" role="button"
            data-act="rowtap" data-id="${esc(r.studentId)}">
          <span class="roll">${esc(st.roll.slice(-3))}</span>
          <span class="who"><b>${esc(st.name)}</b><small>${esc(st.roll)}${
            st.admitType === 'direct-se' ? ' · direct second year' : ''}</small></span>
          <span class="end">
            ${r.conf != null ? `<span class="conf">${(r.conf * 100).toFixed(0)}%</span>` : ''}
            ${r.crop ? `<img class="thumb" src="${r.crop}" alt="">` : ''}
            ${stateChip(r.state)}
          </span></button>`;
      }).join('')}
    </div>`,
    `<button class="btn ghost" data-act="allabsent">Reset</button>
     <button class="btn" data-act="savesession">Save roll</button>`);
};

ACTIONS.selface = d => { _selFace = _selFace === +d.i ? null : +d.i; render(); };

ACTIONS.rowtap = async d => {
  const s = App.session;
  const row = s.result.rows.find(r => r.studentId === d.id);
  const student = await DB.get('students', d.id);

  if (_selFace !== null) {
    const face = s.result.unassigned.find(f => f.i === _selFace);
    return assignFaceTo(face, student, row);
  }

  sheet(`<h2>${esc(student.name)}</h2>
    <p class="note">${esc(student.roll)}${row.conf != null ? ` · matched at ${(row.conf * 100).toFixed(0)}%` : ''}</p>
    ${row.crop ? `<img class="thumb lg" src="${row.crop}" alt="Face matched to this student">` : ''}
    <div class="seg">
      <button data-s="present" class="${row.state === 'present' ? 'on' : ''}">Present</button>
      <button data-s="review" class="${row.state === 'review' ? 'on' : ''}">Check</button>
      <button data-s="absent" class="${row.state === 'absent' ? 'on' : ''}">Absent</button>
    </div>
    ${row.alternatives?.length > 1 ? `<div><h3>Other candidates</h3>${
      (await Promise.all(row.alternatives.slice(1, 4).map(async a => {
        const st = await DB.get('students', a.studentId);
        return st ? `<p class="note">${esc(st.name)} — ${(a.score * 100).toFixed(0)}%</p>` : '';
      }))).join('')}</div>` : ''}`, el => {
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
      const prev = row.state;
      row.state = b.dataset.s;
      row.source = 'manual';
      row.editedBy = App.user.id;
      closeSheet();
      // A student the system called absent but the teacher says is present is
      // exactly the case the gallery should learn from — if we have a face for it.
      if (prev === 'absent' && row.state === 'present' && !row.crop) {
        toast('Marked present. Attach a face from the unplaced strip to teach the system.');
      }
      render();
    });
  });
};

/* The dispute loop, with the two safeguards that stop it poisoning the gallery:
   the crop is shown next to the name before anything is written, and every
   addition is reversible and stamped with who approved it. */
async function assignFaceTo(face, student, row) {
  const ok = await confirmSheet('Is this the same person?',
    `<div style="display:flex;gap:.8rem;align-items:center">
       <img class="thumb lg" src="${face.crop}" alt="The unidentified face">
       <div><b>${esc(student.name)}</b><br><span class="note">${esc(student.roll)}</span>
       ${face.best ? `<br><span class="note">closest existing match was ${(face.best.score * 100).toFixed(0)}%</span>` : ''}
       </div></div>
     <p class="note">Confirming marks them present and adds this face to their profile, so it is
     recognised next time. You can undo this from the student's page.</p>
     ${face.tooSmall ? '<p class="note warn">This face is small. Adding a blurry face can make future matching worse.</p>' : ''}`,
    'Yes, add it');
  if (!ok) return;

  row.state = 'present';
  row.source = 'override';
  row.crop = face.crop;
  row.editedBy = App.user.id;
  face.assigned = student.id;
  _selFace = null;

  if (face.emb) {
    const existing = await DB.where('templates', t => t.studentId === student.id && t.active);
    const cap = Settings.get('maxTemplates');
    if (existing.length >= cap) {
      const oldest = existing.filter(t => t.source !== 'enrol').sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) { oldest.active = false; oldest.retiredAt = Date.now(); await DB.put('templates', oldest); }
    }
    await DB.put('templates', {
      id: uid('tpl'), studentId: student.id, active: true, source: 'dispute',
      emb: new Float32Array(face.emb).buffer, chip: face.crop,
      createdAt: Date.now(), createdBy: App.user.id, sessionId: App.session.id,
    });
    await Audit.log(App.user.id, 'template.add', {
      studentId: student.id, source: 'dispute', sessionId: App.session.id });
    toast(`Added to ${student.name.split(' ')[0]}'s profile.`);
  } else {
    toast('Marked present.');
  }
  render();
}

ACTIONS.allabsent = async () => {
  if (!await confirmSheet('Reset the whole roll?', '<p class="note">Every student goes back to absent. Faces already learned are kept.</p>', 'Reset', true)) return;
  App.session.result.rows.forEach(r => { r.state = 'absent'; r.source = 'manual'; r.crop = null; r.conf = null; });
  App.session.result.unassigned.forEach(f => { f.assigned = null; });
  _selFace = null;
  render();
};

ACTIONS.savesession = async () => {
  const s = App.session;
  const stillChecking = s.result.rows.filter(r => r.state === 'review').length;
  if (stillChecking) {
    const ok = await confirmSheet(`${stillChecking} student(s) still need checking`,
      `<p class="note">Anything left on Check is saved as absent. You can reopen this roll later.</p>`,
      'Save anyway');
    if (!ok) return;
  }
  const rows = s.result.rows.map(r => ({
    id: uid('att'), sessionId: s.id, studentId: r.studentId,
    state: r.state === 'review' ? 'absent' : r.state,
    flagged: r.state === 'review',
    conf: r.conf ?? null, source: r.source, crop: r.crop || null,
    editedBy: r.editedBy || null, at: Date.now(),
  }));
  const session = {
    id: s.id, klassId: s.klassId, teacherId: s.teacherId, slotId: s.slotId,
    date: s.date, startedAt: s.startedAt, closedAt: Date.now(),
    deviceId: s.deviceId, overrideReason: s.overrideReason,
    engine: s.engineUsed || 'manual', shots: s.shots.length,
    threshold: Settings.get('acceptThreshold'),
    stats: s.result.stats,
    present: rows.filter(r => r.state === 'present').length,
    total: rows.length,
    status: 'closed',
  };
  session.seal = await sealSession(session, rows);
  await DB.putAll('attendance', rows);
  await DB.put('sessions', session);
  await Audit.log(App.user.id, 'session.close', {
    sessionId: s.id, klassId: s.klassId, present: session.present, total: session.total, seal: session.seal });
  App.session = null;
  closeCam();
  toast(`Roll saved — ${session.present} of ${session.total} present.`);
  App.stack = [];
  go('sessionview', { id: session.id }, true);
};
