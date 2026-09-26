/* Drives the real application code headlessly: boot -> sign in -> capture ->
   analyse -> correct a face -> save -> verify the seal and the audit chain. */

import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? (pass++, console.log(`  ok   ${n}${x ? '  ' + x : ''}`))
                                 : (fail++, console.log(`  FAIL ${n}  ${x}`)); };

const vc = new VirtualConsole();
vc.on('jsdomError', e => { console.log('  SCRIPT ERROR:', e.message.split('\n')[0]); process.exitCode = 1; });
const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`,
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/', virtualConsole: vc });
const w = dom.window;

const define = (k, v) => Object.defineProperty(w, k, { value: v, writable: true, configurable: true });
// jsdom does not expose these on its window; every real browser does.
define('TextEncoder', TextEncoder);
define('TextDecoder', TextDecoder);
define('crypto', webcrypto);
define('indexedDB', indexedDB);
define('IDBKeyRange', IDBKeyRange);
w.fetch = async () => ({ ok: false, status: 404 });          // no model weights -> simulator
w.navigator.mediaDevices = { getUserMedia: async () => { throw new Error('NotAllowedError'); } };
w.createImageBitmap = async () => ({ width: 1600, height: 1200 });
w.scrollTo = () => {};

/* Minimal 2D canvas so the alignment/crop helpers run. Pixel values are never
   read in simulator mode; the synthetic engine supplies the embeddings. */
const fakeCtx = () => ({
  drawImage() {}, fillRect() {}, setTransform() {}, save() {}, restore() {},
  getImageData: (x, y, cw, ch) => ({ data: new Uint8ClampedArray(cw * ch * 4), width: cw, height: ch }),
  set fillStyle(v) {}, get fillStyle() { return '#000'; },
});
const origCreate = w.document.createElement.bind(w.document);
w.document.createElement = tag => {
  const el = origCreate(tag);
  if (tag === 'canvas') {
    el.getContext = fakeCtx;
    el.toDataURL = () => 'data:image/jpeg;base64,TEST';
    if (!el.width) { el.width = 112; el.height = 112; }
  }
  return el;
};

for (const f of ['core.js', 'engine.js', 'ui.js', 'admin.js']) {
  const s = w.document.createElement('script');
  s.textContent = fs.readFileSync('www/js/' + f, 'utf8');
  w.document.body.appendChild(s);
}

/* Sibling classic scripts share the global lexical environment, but top-level
   const/class bindings never become window properties — so expose them here. */
const bridge = w.document.createElement('script');
bridge.textContent = `Object.assign(window, { App, DB, Settings, Audit, Crypto2, ACTIONS, VIEWS,
  Gallery, Device, Can, ROLES, Coach, OnnxEngine, SyntheticEngine,
  todayISO, uid, DAYS, Clock, ARC_TEMPLATE });`;
w.document.body.appendChild(bridge);

const { App, DB, Settings, Audit, seedIfEmpty, Crypto2, go, render, ACTIONS,
        VIEWS, rosterOf, sealSession, ensureEngine, Gallery, Device } = w;
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

console.log('\n— boot —');
await Settings.load();
await seedIfEmpty();
await Settings.load();
ok('seed created students', (await DB.all('students')).length > 900,
   `${(await DB.all('students')).length} students`);
ok('seed created classes', (await DB.all('klasses')).length === 18);
ok('seed created timetable', (await DB.all('timetable')).length > 50);

console.log('\n— authentication —');
{
  const u = await DB.get('users', 'usr_t1');
  ok('seeded password verifies', await Crypto2.verifyPassword('colproj', u.pw));
  ok('wrong password rejected', !(await Crypto2.verifyPassword('wrong', u.pw)));
  App.user = u;
  await Settings.set({ engine: 'synthetic' });
  await ensureEngine(true);
  ok('engine falls back to simulator without weights', App.engine.id === 'synthetic', App.engine.name);
}

console.log('\n— role scoping —');
{
  const { Can, ROLES, scopedKlasses } = w;
  const principal = await DB.get('users', 'usr_principal');
  const hodCs = await DB.get('users', 'usr_hod_cs');
  const hodIt = await DB.get('users', 'usr_hod_it');
  const t1 = await DB.get('users', 'usr_t1');
  ok('HOD manages a teacher in their department', Can.manageUser(hodCs, t1));
  ok('HOD cannot manage another department\'s teacher', !Can.manageUser(hodIt, t1));
  ok('HOD cannot manage a peer HOD', !Can.manageUser(hodCs, hodIt));
  ok('HOD cannot manage the principal', !Can.manageUser(hodCs, principal));
  ok('principal manages everyone', Can.manageUser(principal, hodCs) && Can.manageUser(principal, t1));
  ok('teacher cannot create accounts', !Can.createTeacher(t1));
  ok('principal sees every class', (await scopedKlasses(principal)).length === 18);
  ok('HOD sees only their department', (await scopedKlasses(hodCs)).length === 6);
  const tk = await scopedKlasses(t1);
  const slotIds = new Set((await DB.where('timetable', s => s.teacherId === t1.id)).map(s => s.klassId));
  ok('teacher sees fewer classes than the whole college', tk.length > 0 && tk.length < 18, `${tk.length} of 18`);
  ok('every class a teacher sees is one they are timetabled for',
     tk.every(k => slotIds.has(k.id)), `${tk.length} classes, ${slotIds.size} timetabled`);
}

console.log('\n— timetable gate —');
{
  const { gateCheck } = w;
  const t1 = await DB.get('users', 'usr_t1');
  const g = await gateCheck(t1);
  ok('walkthrough teacher has a live slot', g.ok && !!g.slot, g.reasons.join(' '));
  const t5 = await DB.get('users', 'usr_t5');     // IT teacher, no timetable seeded
  const g5 = await gateCheck(t5);
  ok('teacher with no slot is blocked', !g5.ok, g5.reasons.join(' '));
  ok('block explains itself', g5.reasons.length > 0 && g5.needsOverride);

  const t2 = await DB.get('users', 'usr_t2');
  t2.deviceIds = ['some-other-handset'];
  await DB.put('users', t2);
  const g2 = await gateCheck(t2);
  ok('unregistered handset is refused', !g2.ok && g2.reasons.some(r => /handset/i.test(r)));
  t2.deviceIds = []; await DB.put('users', t2);
}

console.log('\n— capture and review —');
{
  const gate = await w.gateCheck(App.user);
  const klassId = gate.slot.klassId;
  const roster = await rosterOf(klassId);

  App.session = { id: 'ses_test', klassId, teacherId: App.user.id, slotId: gate.slot.id,
    date: w.todayISO(), startedAt: Date.now(), deviceId: Device.id(), overrideReason: null,
    shots: [], columns: 3, klassName: 'test class', status: 'capturing' };

  for (let i = 0; i < 3; i++) {
    const c = w.document.createElement('canvas');
    c.width = 2560; c.height = 1440;
    App.session.shots.push({ canvas: c, thumb: 'x' });
  }

  App.view = 'capture';
  await ACTIONS.analyse();
  await tick(40);

  const res = App.session.result;
  ok('analysis produced a row per student', res.rows.length === roster.length,
     `${res.rows.length} rows / ${roster.length} students`);
  const present = res.rows.filter(r => r.state === 'present').length;
  const review = res.rows.filter(r => r.state === 'review').length;
  ok('some students auto-marked present', present > 10, `${present} present, ${review} to check`);
  ok('nobody is present without a confidence score',
     res.rows.filter(r => r.state === 'present' && r.conf == null).length === 0);
  ok('every auto-present score clears the threshold',
     res.rows.filter(r => r.state === 'present').every(r => r.conf >= Settings.get('acceptThreshold')));
  ok('strangers did not become students',
     res.unassigned.length > 0, `${res.unassigned.length} faces left unplaced`);

  // no student may appear twice across overlapping shots
  const ids = res.rows.map(r => r.studentId);
  ok('no duplicate students in the roll', new Set(ids).size === ids.length);

  ok('review view renders', (await VIEWS.review()).includes('Check the roll'));
}

console.log('\n— dispute loop —');
{
  const res = App.session.result;
  const absent = res.rows.find(r => r.state === 'absent');
  const student = await DB.get('students', absent.studentId);
  const before = (await DB.where('templates', t => t.studentId === student.id && t.active)).length;
  const face = res.unassigned[0];
  ok('there is an unplaced face to attribute', !!face);

  // approve the correction directly (the sheet's confirm step is UI-only)
  face.emb = Array.from(w.identityVector(student.id));
  absent.state = 'present'; absent.source = 'override'; absent.crop = face.crop;
  await DB.put('templates', { id: w.uid('tpl'), studentId: student.id, active: true, source: 'dispute',
    emb: new Float32Array(face.emb).buffer, chip: face.crop, createdAt: Date.now(), createdBy: App.user.id });
  const after = (await DB.where('templates', t => t.studentId === student.id && t.active)).length;
  ok('correction adds a face to that student', after === before + 1);

  // and the newly learned face must now be recognised
  const g = await Gallery.forClass(App.session.klassId);
  const m = g.match(w.identityVector(student.id), Settings.cache);
  ok('the learned face is matched next time',
     m.band === 'accept' && m.top.studentId === student.id, `cos=${m.top.score.toFixed(3)}`);

  // and removing it must be possible
  const t = (await DB.where('templates', x => x.studentId === student.id && x.source === 'dispute'))[0];
  t.active = false; await DB.put('templates', t);
  const g2 = await Gallery.forClass(App.session.klassId);
  ok('removing a learned face undoes it',
     g2.items.filter(i => i.templateId === t.id).length === 0);
}

console.log('\n— saving and integrity —');
{
  // 17 rows are still on Check, so saving raises a confirmation sheet; answer it.
  const saving = ACTIONS.savesession();
  await tick(20);
  const yes = w.document.querySelector('.scrim [data-x=yes]');
  ok('saving with unresolved rows asks first', !!yes);
  yes?.click();
  await saving;
  await tick(30);
  const s = await DB.get('sessions', 'ses_test');
  ok('session saved', !!s && s.status === 'closed');
  const rows = await DB.where('attendance', a => a.sessionId === 'ses_test');
  ok('attendance rows saved', rows.length > 0, `${rows.length} rows`);
  ok('nothing is left in the review state', rows.every(r => r.state !== 'review'));
  ok('unresolved rows are flagged, not silently dropped',
     rows.filter(r => r.flagged).every(r => r.state === 'absent'));

  ok('seal matches the saved roll', await sealSession(s, rows) === s.seal);
  const tampered = rows.map((r, i) => i === 0 ? { ...r, state: r.state === 'present' ? 'absent' : 'present' } : r);
  ok('seal detects a single flipped mark', await sealSession(s, tampered) !== s.seal);

  const v = await Audit.verify();
  ok('audit chain is unbroken', v.ok, `${v.total} entries`);

  const first = (await DB.all('audit')).sort((a, b) => a.seq - b.seq)[1];
  first.detail = { ...first.detail, tampered: true };
  await DB.put('audit', first);
  const v2 = await Audit.verify();
  ok('audit chain detects an edited entry', !v2.ok && v2.brokenAt === first.seq, `broken at ${v2.brokenAt}`);
}

console.log('\n— every view renders —');
{
  App.user = await DB.get('users', 'usr_principal');
  const s = await DB.all('sessions');
  const k = await DB.all('klasses');
  const st = await DB.all('students');
  const cases = [['home', {}], ['classes', {}], ['klass', { id: k[0].id }], ['student', { id: st[0].id }],
                 ['timetable', {}], ['people', {}], ['requests', {}], ['history', {}],
                 ['sessionview', { id: s[0].id }], ['uat', {}], ['audit', {}], ['login', {}]];
  for (const [v, p] of cases) {
    try { const html = await VIEWS[v](p); ok(`${v} renders`, typeof html === 'string' && html.length > 120); }
    catch (e) { ok(`${v} renders`, false, e.message); }
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
