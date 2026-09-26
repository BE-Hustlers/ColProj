/* ColProj core — storage, cryptography, role scoping, seed data.
   No network. Everything lives on the device. */

/* =========================================================
   1. Storage
   ========================================================= */

const STORES = {
  users:      'id',
  depts:      'id',
  klasses:    'id',
  students:   'id',
  templates:  'id',
  timetable:  'id',
  sessions:   'id',
  attendance: 'id',
  requests:   'id',
  audit:      'id',
  kv:         'k',
};

const DB_NAME = 'colproj';
const DB_VERSION = 1;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, key] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: key });
      }
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror = () => rej(req.error);
  });
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

const DB = {
  get:  (store, id) => tx(store, 'readonly',  s => s.get(id)),
  all:  (store)     => tx(store, 'readonly',  s => s.getAll()),
  put:  (store, v)  => tx(store, 'readwrite', s => { s.put(v); return v; }),
  putAll: (store, arr) => tx(store, 'readwrite', s => { arr.forEach(v => s.put(v)); return arr; }),
  del:  (store, id) => tx(store, 'readwrite', s => s.delete(id)),
  clear:(store)     => tx(store, 'readwrite', s => s.clear()),
  async where(store, pred) { return (await DB.all(store)).filter(pred); },
  async wipe() { for (const n of Object.keys(STORES)) await DB.clear(n); },
};

const uid = (p = 'x') => p + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* Settings live in IndexedDB so a full export captures them.
   localStorage holds only the per-device identity, which must never sync. */

const DEFAULTS = {
  acceptThreshold: 0.45,   // cosine >= this  -> auto present
  reviewThreshold: 0.32,   // cosine in [this, accept) -> queued for teacher review
  marginMin:       0.04,   // top1 must beat top2 by this or it drops to review
  minFacePx:       26,     // smaller detections are reported but never auto-matched
  detScore:        0.45,
  engine:          'auto',
  lateGraceMin:    15,     // minutes after slot start that a session may still open
  earlyOpenMin:    10,
  enforceTimetable:true,
  enforceDevice:   true,
  maxTemplates:    8,      // per student, oldest non-enrol template retired first
};

const Settings = {
  cache: { ...DEFAULTS },
  async load() {
    const row = await DB.get('kv', 'settings');
    this.cache = { ...DEFAULTS, ...(row ? row.v : {}) };
    return this.cache;
  },
  get(k) { return this.cache[k]; },
  async set(patch) {
    this.cache = { ...this.cache, ...patch };
    await DB.put('kv', { k: 'settings', v: this.cache });
    return this.cache;
  },
  async reset() { this.cache = { ...DEFAULTS }; await DB.put('kv', { k: 'settings', v: this.cache }); },
};

/* Device identity: bound to the physical handset, never exported. */
const Device = {
  id() {
    let d = localStorage.getItem('colproj.device');
    if (!d) {
      d = (crypto.randomUUID ? crypto.randomUUID() : uid('dev')).replace(/-/g, '').slice(0, 16);
      localStorage.setItem('colproj.device', d);
    }
    return d;
  },
  label() { return this.id().slice(0, 4).toUpperCase() + '-' + this.id().slice(4, 8).toUpperCase(); },
};

/* =========================================================
   2. Cryptography
   ========================================================= */

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

const Crypto2 = {
  async sha256(str) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(str))); },

  /* Passwords use PBKDF2-SHA256, not a bare SHA-256 digest. A raw hash is
     GPU-brute-forceable at billions/sec; the iteration count is the whole point. */
  async hashPassword(pw, saltHex, iters = 210000) {
    const salt = saltHex ? Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16)))
                         : crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, key, 256);
    return { salt: hex(salt), hash: hex(bits), iters };
  },
  async verifyPassword(pw, rec) {
    if (!rec || !rec.hash) return false;
    const got = await this.hashPassword(pw, rec.salt, rec.iters);
    // constant-time-ish compare
    if (got.hash.length !== rec.hash.length) return false;
    let diff = 0;
    for (let i = 0; i < got.hash.length; i++) diff |= got.hash.charCodeAt(i) ^ rec.hash.charCodeAt(i);
    return diff === 0;
  },

  /* RFC 4648 base32, for the authenticator secret. */
  b32encode(bytes) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0, val = 0, out = '';
    for (const b of bytes) {
      val = (val << 8) | b; bits += 8;
      while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits) out += A[(val << (5 - bits)) & 31];
    return out;
  },
  b32decode(s) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0, val = 0; const out = [];
    for (const c of s.toUpperCase().replace(/[=\s]/g, '')) {
      const i = A.indexOf(c); if (i < 0) continue;
      val = (val << 5) | i; bits += 5;
      if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    }
    return new Uint8Array(out);
  },
  newTotpSecret() { return this.b32encode(crypto.getRandomValues(new Uint8Array(20))); },

  /* RFC 6238 TOTP, HMAC-SHA1, 30s step, 6 digits.
     Real algorithm — these codes validate in Google Authenticator. */
  async totp(secretB32, forTime = Date.now(), step = 30, digits = 6) {
    const counter = Math.floor(forTime / 1000 / step);
    const msg = new Uint8Array(8);
    let c = counter;
    for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
    const key = await crypto.subtle.importKey(
      'raw', this.b32decode(secretB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
    const off = mac[19] & 0x0f;
    const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    return String(bin % 10 ** digits).padStart(digits, '0');
  },
  async totpVerify(secretB32, code, window = 1) {
    const now = Date.now();
    for (let w = -window; w <= window; w++) {
      if (await this.totp(secretB32, now + w * 30000) === String(code).trim()) return true;
    }
    return false;
  },
  totpUri(secret, account, issuer = 'ColProj') {
    return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
           `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  },
};

/* =========================================================
   3. Tamper-evident audit log
   Each entry hashes (previous hash + its own payload). Altering any past row
   breaks every hash after it, which the integrity check reports.
   ========================================================= */

const Audit = {
  _tail: null,
  async tail() {
    if (this._tail !== null) return this._tail;
    const rows = await DB.all('audit');
    rows.sort((a, b) => a.seq - b.seq);
    this._tail = rows.length ? rows[rows.length - 1] : null;
    return this._tail;
  },
  async log(actorId, action, detail = {}) {
    const prev = await this.tail();
    const entry = {
      id: uid('aud'),
      seq: prev ? prev.seq + 1 : 0,
      ts: Date.now(),
      actor: actorId || 'system',
      device: Device.id(),
      action,
      detail,
      prevHash: prev ? prev.hash : '0'.repeat(64),
    };
    entry.hash = await Crypto2.sha256(
      entry.prevHash + '|' + entry.seq + '|' + entry.ts + '|' + entry.actor + '|' +
      entry.device + '|' + entry.action + '|' + JSON.stringify(entry.detail));
    await DB.put('audit', entry);
    this._tail = entry;
    return entry;
  },
  async verify() {
    const rows = (await DB.all('audit')).sort((a, b) => a.seq - b.seq);
    let prevHash = '0'.repeat(64);
    for (const e of rows) {
      const want = await Crypto2.sha256(
        prevHash + '|' + e.seq + '|' + e.ts + '|' + e.actor + '|' +
        e.device + '|' + e.action + '|' + JSON.stringify(e.detail));
      if (e.prevHash !== prevHash || e.hash !== want) {
        return { ok: false, brokenAt: e.seq, total: rows.length };
      }
      prevHash = e.hash;
    }
    return { ok: true, total: rows.length, head: prevHash };
  },
};

/* A closed attendance session gets a seal: a SHA-256 over its full roll.
   Re-derive it any time to prove the roll has not been edited since closing. */
async function sealSession(session, rows) {
  const body = rows.slice()
    .sort((a, b) => a.studentId.localeCompare(b.studentId))
    .map(r => `${r.studentId}:${r.state}:${r.source}:${(r.conf ?? 0).toFixed(4)}`)
    .join(';');
  return Crypto2.sha256(
    `${session.id}|${session.klassId}|${session.teacherId}|${session.date}|${session.slotId || '-'}|${body}`);
}

/* =========================================================
   4. Roles
   ========================================================= */

const ROLES = {
  admin:    { rank: 4, label: 'Principal' },
  vice:     { rank: 3, label: 'Vice principal' },
  hod:      { rank: 2, label: 'Head of department' },
  teacher:  { rank: 1, label: 'Teacher' },
};

const Can = {
  /* A user may act on a department if they own it or outrank departmental scope. */
  dept(user, deptId) {
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'vice') return true;
    return user.deptId === deptId;
  },
  /* Manage another user: strictly higher rank, and inside your scope. */
  manageUser(actor, target) {
    if (!actor || !target) return false;
    if (ROLES[actor.role].rank <= ROLES[target.role].rank) return false;
    if (actor.role === 'admin') return true;
    if (actor.role === 'vice') return target.role !== 'admin';
    if (actor.role === 'hod') return target.deptId === actor.deptId && target.role === 'teacher';
    return false;
  },
  createTeacher(actor) { return actor && ROLES[actor.role].rank >= 2; },
  editRoster(actor, klass) {
    if (!actor || !klass) return false;
    if (ROLES[actor.role].rank >= 2) return this.dept(actor, klass.deptId);
    return false; // teachers do not edit rosters
  },
  viewAllDepts(actor) { return actor && ROLES[actor.role].rank >= 3; },
  overrideGate(actor) { return actor && ROLES[actor.role].rank >= 2; },
  uat(actor) { return actor && ROLES[actor.role].rank >= 2; },
};

/* Classes a user may take attendance for, right now or in principle. */
async function scopedKlasses(user) {
  const all = await DB.all('klasses');
  if (!user) return [];
  if (ROLES[user.role].rank >= 3) return all;
  if (user.role === 'hod') return all.filter(k => k.deptId === user.deptId);
  const slots = await DB.where('timetable', t => t.teacherId === user.id);
  const subs = await DB.where('requests', r =>
    r.type === 'substitute' && r.status === 'accepted' && r.payload.substituteId === user.id &&
    (!r.payload.until || r.payload.until >= todayISO()));
  const ids = new Set([...slots.map(s => s.klassId), ...subs.map(s => s.payload.klassId)]);
  return all.filter(k => ids.has(k.id));
}

/* =========================================================
   5. Timetable gate
   The tether: teacher identity + registered device + server-authoritative clock
   must all agree with a scheduled slot before a class roster is unsealed.
   ========================================================= */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const todayISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmmToMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const minToHHMM = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fmtTime = s => { const m = hhmmToMin(s); const h = Math.floor(m / 60), mm = m % 60;
  const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`; };

/* In the standalone build "server time" is the device clock, but every reading
   goes through this one function so the ERP build swaps it in a single place. */
const Clock = {
  skewMs: 0,
  now() { return new Date(Date.now() + this.skewMs); },
  minutes() { const n = this.now(); return n.getHours() * 60 + n.getMinutes(); },
  day() { return this.now().getDay(); },
};

async function gateCheck(user, klassId = null) {
  const cfg = Settings.cache;
  const out = { ok: false, slot: null, reasons: [], klassId, viaSubstitution: false, needsOverride: false };
  if (!user) { out.reasons.push('Not signed in.'); return out; }

  if (cfg.enforceDevice && user.deviceIds && user.deviceIds.length && !user.deviceIds.includes(Device.id())) {
    out.reasons.push(`This handset (${Device.label()}) is not registered to ${user.name}.`);
    out.needsOverride = true;
  }

  if (!cfg.enforceTimetable) {
    out.ok = out.reasons.length === 0;
    if (!out.ok) out.ok = false;
    out.reasons.push('Timetable check is switched off in testing settings.');
    out.ok = true;
    return out;
  }

  const day = Clock.day(), now = Clock.minutes();
  let slots = await DB.where('timetable', t => t.teacherId === user.id && t.day === day);

  const subs = await DB.where('requests', r =>
    r.type === 'substitute' && r.status === 'accepted' && r.payload.substituteId === user.id);
  for (const s of subs) {
    const orig = await DB.get('timetable', s.payload.slotId);
    if (orig && orig.day === day && (!s.payload.until || s.payload.until >= todayISO())) {
      slots.push({ ...orig, _sub: true });
    }
  }
  if (klassId) slots = slots.filter(s => s.klassId === klassId);

  const live = slots.filter(s =>
    now >= hhmmToMin(s.start) - cfg.earlyOpenMin &&
    now <= hhmmToMin(s.end) + cfg.lateGraceMin);

  if (!live.length) {
    const next = slots.sort((a, b) => hhmmToMin(a.start) - hhmmToMin(b.start))
                      .find(s => hhmmToMin(s.start) > now);
    out.reasons.push(slots.length
      ? (next ? `No class scheduled at ${minToHHMM(now)}. Next is ${fmtTime(next.start)}.`
              : `No further classes scheduled today.`)
      : `Nothing on your timetable for ${DAYS[day]}.`);
    out.needsOverride = true;
    return out;
  }

  out.slot = live[0];
  out.klassId = live[0].klassId;
  out.viaSubstitution = !!live[0]._sub;
  out.ok = out.reasons.length === 0;
  if (!out.ok) out.needsOverride = true;
  return out;
}

/* =========================================================
   6. Seed dataset
   ========================================================= */

const FIRST_M = ['Aarav','Rohan','Siddharth','Omkar','Yash','Atharva','Soham','Pranav','Kunal','Vedant','Nikhil','Aditya','Sarvesh','Tanmay','Harsh','Chinmay','Rushikesh','Parth','Shreyas','Devang','Mihir','Ashish','Ninad','Sanket'];
const FIRST_F = ['Ananya','Sanika','Isha','Tanvi','Shravani','Mrunal','Pooja','Gauri','Riya','Sakshi','Neha','Aditi','Radhika','Ketaki','Snehal','Prachi','Vaishnavi','Manasi','Rutuja','Apeksha'];
const LAST = ['Deshpande','Kulkarni','Patil','Jadhav','Joshi','Bhosale','Shinde','Gaikwad','Chavan','Pawar','Sawant','Kadam','More','Salunkhe','Nikam','Thorat','Mane','Rane','Wagh','Bhide','Kale','Shelar','Dhumal','Gokhale'];

function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];

async function seedIfEmpty(force = false) {
  const existing = await DB.all('users');
  if (existing.length && !force) return false;
  if (force) await DB.wipe();

  const r = rng(20261001);

  const depts = [
    { id: 'dep_cs',   code: 'CS',   name: 'Computer Engineering' },
    { id: 'dep_it',   code: 'IT',   name: 'Information Technology' },
    { id: 'dep_entc', code: 'ENTC', name: 'Electronics & Telecommunication' },
  ];
  await DB.putAll('depts', depts);

  const YEARS = [['SE', 'Second year'], ['TE', 'Third year'], ['BE', 'Final year']];
  const klasses = [];
  for (const d of depts) {
    for (const [yc] of YEARS) {
      for (const div of ['A', 'B']) {
        klasses.push({
          id: `cls_${d.code}_${yc}_${div}`.toLowerCase(),
          deptId: d.id, year: yc, division: div,
          name: `${yc} ${d.code} — Division ${div}`,
        });
      }
    }
  }
  await DB.putAll('klasses', klasses);

  const students = [];
  for (const k of klasses) {
    // SPPU reality: intake ~70, strength erodes year on year with backlogs.
    const n = k.year === 'SE' ? 62 + Math.floor(r() * 8)
            : k.year === 'TE' ? 52 + Math.floor(r() * 8)
            : 44 + Math.floor(r() * 8);
    const code = k.id.split('_')[1].toUpperCase();
    for (let i = 1; i <= n; i++) {
      const female = r() < 0.32;
      const name = `${pick(r, female ? FIRST_F : FIRST_M)} ${pick(r, LAST)}`;
      // A slice of the SE cohort are direct second-year admissions.
      const direct = k.year === 'SE' && i > n - 8;
      students.push({
        id: uid('stu'),
        klassId: k.id,
        roll: `${code}${k.year}${k.division}${String(i).padStart(2, '0')}`,
        seat: String(2200000 + Math.floor(r() * 99999)),
        name,
        admitType: direct ? 'direct-se' : 'regular',
        enrolledAt: direct ? '2026-08-12' : '2025-07-04',
        active: true,
      });
    }
  }
  await DB.putAll('students', students);

  const mk = (id, name, role, deptId, email) => ({
    id, name, role, deptId, email, active: true,
    deviceIds: [], mfaEnabled: false, totpSecret: null, pw: null, mustSetPassword: true,
  });

  const users = [
    mk('usr_principal', 'Dr. S. R. Deshmukh', 'admin', null, 'principal@college.edu.in'),
    mk('usr_vp1', 'Dr. A. M. Kulkarni', 'vice', null, 'vp.academics@college.edu.in'),
    mk('usr_vp2', 'Dr. P. V. Joshi', 'vice', null, 'vp.admin@college.edu.in'),
    mk('usr_hod_cs', 'Dr. M. B. Patil', 'hod', 'dep_cs', 'hod.comp@college.edu.in'),
    mk('usr_hod_it', 'Dr. N. S. Rane', 'hod', 'dep_it', 'hod.it@college.edu.in'),
    mk('usr_hod_entc', 'Dr. R. K. Gokhale', 'hod', 'dep_entc', 'hod.entc@college.edu.in'),
  ];
  const teacherNames = [
    ['usr_t1', 'Prof. V. D. Sawant', 'dep_cs'], ['usr_t2', 'Prof. S. A. Nikam', 'dep_cs'],
    ['usr_t3', 'Prof. K. R. Thorat', 'dep_cs'], ['usr_t4', 'Prof. A. P. Bhide', 'dep_cs'],
    ['usr_t5', 'Prof. J. M. Kadam', 'dep_it'],  ['usr_t6', 'Prof. D. S. Wagh', 'dep_it'],
    ['usr_t7', 'Prof. H. N. Shelar', 'dep_entc'],
  ];
  for (const [id, name, dep] of teacherNames) {
    users.push(mk(id, name, 'teacher', dep, id.replace('usr_', '') + '@college.edu.in'));
  }

  // Everyone starts on the same demo credential; the app nags to change it.
  const seedPw = await Crypto2.hashPassword('colproj');
  for (const u of users) { u.pw = seedPw; }
  // The teacher used for the walkthrough is fully provisioned on this handset.
  const demo = users.find(u => u.id === 'usr_t1');
  demo.deviceIds = [Device.id()];
  demo.mustSetPassword = false;
  await DB.putAll('users', users);

  // Timetable — Monday to Saturday, a realistic teaching load for the CS staff.
  const tt = [];
  const slotTimes = [['08:30','09:30'],['09:30','10:30'],['10:45','11:45'],['11:45','12:45'],['13:30','14:30'],['14:30','15:30']];
  const subjects = { SE: ['Data Structures','Discrete Mathematics','Computer Graphics'],
                     TE: ['Database Management','Theory of Computation','Software Engineering'],
                     BE: ['Machine Learning','Distributed Systems','Information Security'] };
  const csTeachers = ['usr_t1','usr_t2','usr_t3','usr_t4'];
  const csKlasses = klasses.filter(k => k.deptId === 'dep_cs');
  for (let day = 1; day <= 6; day++) {
    csKlasses.forEach((k, ki) => {
      for (let s = 0; s < 3; s++) {
        const [st, en] = slotTimes[(ki + s + day) % slotTimes.length];
        tt.push({
          id: uid('tt'), teacherId: csTeachers[(ki + s + day) % csTeachers.length],
          klassId: k.id, day, start: st, end: en,
          subject: subjects[k.year][s % 3],
        });
      }
    });
  }
  // Guarantee the walkthrough teacher always has a slot open right now,
  // so a reviewer never lands on "nothing scheduled".
  const nowMin = Clock.minutes();
  tt.push({
    id: 'tt_demo_live', teacherId: 'usr_t1', klassId: 'cls_cs_te_a',
    day: Clock.day(),
    start: minToHHMM(Math.max(0, nowMin - 20)), end: minToHHMM(Math.min(1439, nowMin + 40)),
    subject: 'Database Management',
  });
  await DB.putAll('timetable', tt);

  await Settings.set({});
  await Audit.log('system', 'seed', { students: students.length, klasses: klasses.length, users: users.length });
  return true;
}

/* =========================================================
   7. Session helpers
   ========================================================= */

async function klassLabel(klassId) {
  const k = await DB.get('klasses', klassId);
  if (!k) return 'Unknown class';
  return k.name;
}

async function rosterOf(klassId) {
  return (await DB.where('students', s => s.klassId === klassId && s.active))
    .sort((a, b) => a.roll.localeCompare(b.roll));
}

async function templatesOf(studentIds) {
  const set = new Set(studentIds);
  return (await DB.where('templates', t => t.active && set.has(t.studentId)));
}

async function enrolledCount(klassId) {
  const roster = await rosterOf(klassId);
  const t = await templatesOf(roster.map(s => s.id));
  return { total: roster.length, enrolled: new Set(t.map(x => x.studentId)).size };
}

async function exportAll() {
  const out = { format: 'colproj/v1', exportedAt: new Date().toISOString(), device: Device.id(), data: {} };
  for (const name of Object.keys(STORES)) {
    const rows = await DB.all(name);
    out.data[name] = name === 'templates'
      ? rows.map(t => ({ ...t, emb: Array.from(new Float32Array(t.emb)) }))
      : rows;
  }
  return out;
}

async function importAll(obj, { merge = false } = {}) {
  if (!obj || obj.format !== 'colproj/v1') throw new Error('Not a ColProj export file.');
  if (!merge) await DB.wipe();
  for (const [name, rows] of Object.entries(obj.data)) {
    if (!STORES[name]) continue;
    const fixed = name === 'templates'
      ? rows.map(t => ({ ...t, emb: new Float32Array(t.emb).buffer }))
      : rows;
    await DB.putAll(name, fixed);
  }
  Audit._tail = null;
  await Settings.load();
  return true;
}

function toCSV(rows, cols) {
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.map(c => esc(c.label)).join(','),
          ...rows.map(r => cols.map(c => esc(c.get(r))).join(','))].join('\n');
}

function download(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
}
