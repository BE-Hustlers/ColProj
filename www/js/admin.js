/* ColProj — roster, enrolment, staff, workflows, testing, integrity. */

/* ---------------------------------------------------------
   Classes and roster
   --------------------------------------------------------- */

VIEWS.classes = async () => {
  const ks = await scopedKlasses(App.user);
  const depts = Object.fromEntries((await DB.all('depts')).map(d => [d.id, d]));
  const rows = [];
  for (const k of ks) {
    const { total, enrolled } = await enrolledCount(k.id);
    rows.push(`<button class="lrow" role="button" data-act="goto" data-to="klass" data-arg='${JSON.stringify({ id: k.id })}'>
      <span class="roll">${esc(k.year)}</span>
      <span class="who"><b>${esc(k.name)}</b><small>${esc(depts[k.deptId]?.code || '')} · ${total} students · ${enrolled} enrolled</small></span>
      <span class="end">${enrolled === 0 ? '<span class="chip r">No faces</span>'
        : enrolled < total ? `<span class="chip r">${Math.round(enrolled / total * 100)}%</span>`
        : '<span class="chip p">Ready</span>'}</span></button>`);
  }
  return shell('Classes', `${ks.length} in your scope`,
    `<div class="ledger">${rows.join('') || '<div class="empty"><strong>No classes</strong>Nothing is assigned to you yet.</div>'}</div>`);
};

VIEWS.klass = async ({ id }) => {
  const k = await DB.get('klasses', id);
  const roster = await rosterOf(id);
  const tpl = await templatesOf(roster.map(s => s.id));
  const count = new Map();
  tpl.forEach(t => count.set(t.studentId, (count.get(t.studentId) || 0) + 1));
  const can = Can.editRoster(App.user, k);
  const sessions = await DB.where('sessions', s => s.klassId === id);

  return shell(k.name, `${roster.length} students · ${count.size} with faces on file · ${sessions.length} rolls taken`,
    `<div class="view">
      <div class="row">
        <button class="btn" data-act="goto" data-to="enrol" data-arg='${JSON.stringify({ klassId: id })}'>Enrol faces</button>
        ${can ? `<button class="btn ghost" data-act="addstudent" data-k="${esc(id)}">Add student</button>` : ''}
      </div>
      <p class="note">Direct second-year admissions are added the same way as anyone else — they just carry a
      different joining date, so their first-year absence never looks like a gap.</p>
    </div>
    <div class="ledger-head"><span class="g">Roll</span><span class="n">Student</span><span>Faces</span></div>
    <div class="ledger">
      ${roster.map(s => {
        const c = count.get(s.id) || 0;
        return `<button class="lrow" role="button" data-act="goto" data-to="student" data-arg='${JSON.stringify({ id: s.id })}'>
          <span class="roll">${esc(s.roll.slice(-3))}</span>
          <span class="who"><b>${esc(s.name)}</b><small>${esc(s.roll)}${s.admitType === 'direct-se' ? ' · direct SE' : ''}</small></span>
          <span class="end">${c ? `<span class="chip p">${c}</span>` : '<span class="chip r">0</span>'}</span></button>`;
      }).join('')}
    </div>`);
};

ACTIONS.addstudent = d => {
  sheet(`<h2>Add a student</h2>
    <label class="fld"><span>Full name</span><input id="nm"></label>
    <div class="row">
      <label class="fld"><span>Roll number</span><input id="rl"></label>
      <label class="fld"><span>Joined in</span><select id="ad">
        <option value="regular">First year</option>
        <option value="direct-se">Direct second year</option></select></label>
    </div>
    <div class="row"><button class="btn ghost" data-x="c">Cancel</button><button class="btn" data-x="ok">Add</button></div>`,
    el => {
      el.querySelector('[data-x=c]').onclick = closeSheet;
      el.querySelector('[data-x=ok]').onclick = async () => {
        const name = el.querySelector('#nm').value.trim();
        const roll = el.querySelector('#rl').value.trim();
        if (!name || !roll) return toast('Name and roll number are both needed.');
        const s = { id: uid('stu'), klassId: d.k, name, roll, admitType: el.querySelector('#ad').value,
                    enrolledAt: todayISO(), active: true, seat: '' };
        await DB.put('students', s);
        await Audit.log(App.user.id, 'student.add', { studentId: s.id, klassId: d.k });
        closeSheet(); toast(`${name} added.`); render();
      };
    });
};

VIEWS.student = async ({ id }) => {
  const s = await DB.get('students', id);
  const tpls = (await DB.where('templates', t => t.studentId === id)).sort((a, b) => b.createdAt - a.createdAt);
  const att = await DB.where('attendance', a => a.studentId === id);
  const present = att.filter(a => a.state === 'present').length;
  const users = Object.fromEntries((await DB.all('users')).map(u => [u.id, u.name]));

  return shell(s.name, `${s.roll} · ${att.length ? Math.round(present / att.length * 100) + '% attendance' : 'no rolls yet'}`,
    `<div class="view">
      <div class="panel">
        <h3>Faces on file</h3>
        <p class="note">Each one is a 512-number descriptor, not a photograph. Added faces can be removed
        at any time, which is what makes a wrong correction recoverable.</p>
      </div>
      ${tpls.length ? `<div class="tiles">${tpls.map(t => `
        <div class="tile">
          ${t.chip ? `<img src="${t.chip}" alt="">` : '<div style="aspect-ratio:1;background:var(--rule-2);border-radius:3px;margin-bottom:.3rem"></div>'}
          <b>${t.source === 'enrol' ? 'Enrolled' : 'Learned'}</b>
          <span class="note">${new Date(t.createdAt).toLocaleDateString()}</span>
          ${t.active ? `<button class="btn ghost sm" data-act="rmtpl" data-id="${esc(t.id)}" style="margin-top:.35rem;width:100%">Remove</button>`
                     : '<span class="chip n" style="margin-top:.35rem">Retired</span>'}
          ${t.createdBy && users[t.createdBy] ? `<span class="note" style="display:block;font-size:.66rem">by ${esc(users[t.createdBy].split(' ').pop())}</span>` : ''}
        </div>`).join('')}</div>` : '<div class="empty"><strong>No faces yet</strong>Enrol this student from the class page.</div>'}
      <div class="view" style="padding:0">
        <button class="btn ghost" data-act="goto" data-to="enrol" data-arg='${JSON.stringify({ klassId: s.klassId, studentId: id })}'>Add a face</button>
      </div>
    </div>`);
};

ACTIONS.rmtpl = async d => {
  if (!await confirmSheet('Remove this face?',
    '<p class="note">Matching will no longer use it. Any attendance already recorded stays as it is.</p>', 'Remove', true)) return;
  const t = await DB.get('templates', d.id);
  t.active = false; t.retiredAt = Date.now(); t.retiredBy = App.user.id;
  await DB.put('templates', t);
  await Audit.log(App.user.id, 'template.remove', { templateId: t.id, studentId: t.studentId });
  toast('Removed.'); render();
};

/* ---------------------------------------------------------
   Enrolment
   --------------------------------------------------------- */

let _enrol = null;

VIEWS.enrol = async ({ klassId, studentId }) => {
  const roster = await rosterOf(klassId);
  const tpl = await templatesOf(roster.map(s => s.id));
  const have = new Set(tpl.map(t => t.studentId));
  _enrol = _enrol && _enrol.klassId === klassId ? _enrol
    : { klassId, studentId: studentId || (roster.find(s => !have.has(s.id)) || roster[0])?.id, shots: [] };
  if (studentId) _enrol.studentId = studentId;

  return shell('Enrol faces', `${have.size} of ${roster.length} done`, `
    <div class="view">
      <label class="fld"><span>Student</span><select id="stu">${roster.map(s =>
        `<option value="${esc(s.id)}" ${s.id === _enrol.studentId ? 'selected' : ''}>
          ${esc(s.roll)} — ${esc(s.name)}${have.has(s.id) ? ' ✓' : ''}</option>`).join('')}</select></label>
      <div class="stage" id="stage"><video id="cam" playsinline muted autoplay></video>
        <div class="badge">Look straight at the camera</div></div>
      <p class="note" id="camnote">Take three or four: straight on, slightly turned, and one in the room's
      normal lighting. Variety matters more than count.</p>
      <div class="shots" id="shots"></div>
      <button class="btn ghost sm" data-act="pickenrol">Use photos from the gallery</button>
      <input type="file" id="efile" accept="image/*" multiple hidden>
    </div>`,
    `<button class="btn go" data-act="esnap">Take photo</button>
     <button class="btn" data-act="esave" id="eSave" ${_enrol.shots.length ? '' : 'disabled'}>Save face</button>`);
};

VIEWS['enrol:mount'] = async () => {
  await openCam();
  renderEnrolShots();
  document.getElementById('stu').onchange = e => { _enrol.studentId = e.target.value; _enrol.shots = []; renderEnrolShots(); };
  document.getElementById('efile').onchange = async e => {
    for (const f of e.target.files) {
      const img = await createImageBitmap(f);
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      _enrol.shots.push(c);
    }
    e.target.value = ''; renderEnrolShots();
  };
};
ACTIONS.pickenrol = () => document.getElementById('efile').click();

function renderEnrolShots() {
  const el = document.getElementById('shots');
  if (!el) return;
  el.innerHTML = _enrol.shots.map((c, i) =>
    `<img src="${c.toDataURL('image/jpeg', .5)}" data-act="dropenrol" data-i="${i}" alt="Photo ${i + 1}">`).join('');
  wire(el);
  const b = document.getElementById('eSave'); if (b) b.disabled = !_enrol.shots.length;
}
ACTIONS.dropenrol = d => { _enrol.shots.splice(+d.i, 1); renderEnrolShots(); };

ACTIONS.esnap = () => {
  const v = document.getElementById('cam');
  if (!v || !v.videoWidth) return toast('Camera is not ready. Use gallery photos instead.');
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  _enrol.shots.push(c); renderEnrolShots();
};

ACTIONS.esave = async () => {
  const noteEl = document.getElementById('camnote');
  const say = m => { if (noteEl) noteEl.textContent = m; };
  const engine = await ensureEngine();
  const student = await DB.get('students', _enrol.studentId);
  if (engine.id === 'synthetic') {
    await DB.put('templates', { id: uid('tpl'), studentId: student.id, active: true, source: 'enrol',
      emb: engine.enrolVector(student.id).buffer, chip: _enrol.shots[0]?.toDataURL('image/jpeg', .6) || null,
      createdAt: Date.now(), createdBy: App.user.id });
    await Audit.log(App.user.id, 'template.add', { studentId: student.id, source: 'enrol-sim' });
    _enrol.shots = []; toast(`Saved (simulated) for ${student.name.split(' ')[0]}.`); return render();
  }

  let added = 0, skipped = 0;
  for (const shot of _enrol.shots) {
    say(`Reading photo ${added + skipped + 1} of ${_enrol.shots.length}…`);
    const dets = await engine.detect(shot, { detScore: Settings.get('detScore') });
    if (!dets.length) { skipped++; continue; }
    // enrolment uses the largest face in frame — the subject, not a bystander
    const d = dets.sort((a, b) => (b.box[2] - b.box[0]) - (a.box[2] - a.box[0]))[0];
    const chip = alignChip(shot, d.kps);
    const [emb] = await engine.embed([chip], [d]);
    await DB.put('templates', {
      id: uid('tpl'), studentId: student.id, active: true, source: 'enrol',
      emb: emb.buffer, chip: chip.toDataURL('image/jpeg', .7),
      createdAt: Date.now(), createdBy: App.user.id,
    });
    added++;
  }
  await Audit.log(App.user.id, 'template.add', { studentId: student.id, source: 'enrol', count: added });
  _enrol.shots = [];
  toast(added ? `${added} face(s) saved for ${student.name.split(' ')[0]}${skipped ? `, ${skipped} had no face` : ''}.`
              : 'No face found in those photos.');
  render();
};

/* ---------------------------------------------------------
   Timetable
   --------------------------------------------------------- */

VIEWS.timetable = async () => {
  const u = App.user;
  const mine = ROLES[u.role].rank >= 2;
  const all = await DB.all('timetable');
  const slots = mine ? all : all.filter(t => t.teacherId === u.id);
  const ks = Object.fromEntries((await DB.all('klasses')).map(k => [k.id, k]));
  const us = Object.fromEntries((await DB.all('users')).map(x => [x.id, x]));
  const byDay = {};
  slots.forEach(s => (byDay[s.day] = byDay[s.day] || []).push(s));

  const body = Object.keys(byDay).sort().map(d => `
    <div class="ledger-head"><span class="n">${DAYS[d]}</span><span>${byDay[d].length} slot(s)</span></div>
    <div class="ledger">${byDay[d].sort((a, b) => hhmmToMin(a.start) - hhmmToMin(b.start)).map(s => `
      <button class="lrow" role="button" data-act="editslot" data-id="${esc(s.id)}">
        <span class="roll">${esc(s.start)}</span>
        <span class="who"><b>${esc(ks[s.klassId]?.name || '?')}</b>
          <small>${esc(s.subject)}${mine ? ' · ' + esc(us[s.teacherId]?.name || '?') : ''}</small></span>
        <span class="end"><span class="chip n">${esc(fmtTime(s.end))}</span></span></button>`).join('')}</div>`).join('');

  return shell('Timetable', mine ? 'Whole department' : 'Your classes',
    (body || '<div class="empty"><strong>Nothing scheduled</strong>Add the classes you teach and when.</div>'),
    `<button class="btn" data-act="addslot">Add a class slot</button>`);
};

async function slotSheet(existing) {
  const u = App.user;
  const ks = await scopedKlasses(u);
  const teachers = ROLES[u.role].rank >= 2
    ? (await DB.where('users', x => x.role === 'teacher' && (u.role === 'hod' ? x.deptId === u.deptId : true)))
    : [u];
  const s = existing || { day: Clock.day(), start: '09:30', end: '10:30', subject: '', klassId: ks[0]?.id, teacherId: u.id };
  sheet(`<h2>${existing ? 'Edit slot' : 'Add a class slot'}</h2>
    <label class="fld"><span>Class</span><select id="k">${ks.map(k =>
      `<option value="${esc(k.id)}" ${k.id === s.klassId ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></label>
    <label class="fld"><span>Subject</span><input id="sub" value="${esc(s.subject)}"></label>
    <label class="fld"><span>Teacher</span><select id="t">${teachers.map(t =>
      `<option value="${esc(t.id)}" ${t.id === s.teacherId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
    <label class="fld"><span>Day</span><select id="d">${DAYS.map((n, i) =>
      `<option value="${i}" ${i === s.day ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <div class="row">
      <label class="fld"><span>From</span><input type="time" id="st" value="${esc(s.start)}"></label>
      <label class="fld"><span>To</span><input type="time" id="en" value="${esc(s.end)}"></label>
    </div>
    <div class="row">
      ${existing ? '<button class="btn danger" data-x="del">Delete</button>' : ''}
      <button class="btn ghost" data-x="c">Cancel</button><button class="btn" data-x="ok">Save</button></div>`, el => {
    el.querySelector('[data-x=c]').onclick = closeSheet;
    if (existing) el.querySelector('[data-x=del]').onclick = async () => {
      await DB.del('timetable', existing.id);
      await Audit.log(u.id, 'timetable.delete', { slotId: existing.id });
      closeSheet(); toast('Slot removed.'); render();
    };
    el.querySelector('[data-x=ok]').onclick = async () => {
      const rec = {
        id: existing?.id || uid('tt'),
        klassId: el.querySelector('#k').value,
        subject: el.querySelector('#sub').value.trim() || 'Untitled',
        teacherId: el.querySelector('#t').value,
        day: +el.querySelector('#d').value,
        start: el.querySelector('#st').value,
        end: el.querySelector('#en').value,
      };
      if (hhmmToMin(rec.end) <= hhmmToMin(rec.start)) return toast('The end time must be after the start.');
      const clash = (await DB.where('timetable', t => t.teacherId === rec.teacherId && t.day === rec.day && t.id !== rec.id))
        .find(t => hhmmToMin(rec.start) < hhmmToMin(t.end) && hhmmToMin(t.start) < hhmmToMin(rec.end));
      if (clash) return toast(`That overlaps an existing ${fmtTime(clash.start)} slot.`);
      await DB.put('timetable', rec);
      await Audit.log(u.id, existing ? 'timetable.edit' : 'timetable.add', { slotId: rec.id });
      closeSheet(); toast('Timetable updated.'); render();
    };
  });
}
ACTIONS.addslot = () => slotSheet(null);
ACTIONS.editslot = async d => slotSheet(await DB.get('timetable', d.id));

/* ---------------------------------------------------------
   People
   --------------------------------------------------------- */

VIEWS.people = async () => {
  const u = App.user;
  let users = await DB.all('users');
  if (u.role === 'hod') users = users.filter(x => x.deptId === u.deptId || x.id === u.id);
  const depts = Object.fromEntries((await DB.all('depts')).map(d => [d.id, d]));
  const order = ['admin', 'vice', 'hod', 'teacher'];
  users.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name));

  return shell('People', `${users.length} account(s)`,
    `<div class="ledger">${users.map(x => `
      <button class="lrow" role="button" data-act="edituser" data-id="${esc(x.id)}">
        <span class="roll">${esc(ROLES[x.role].label.slice(0, 3))}</span>
        <span class="who"><b>${esc(x.name)}</b><small>${esc(x.email)}${x.deptId ? ' · ' + esc(depts[x.deptId].code) : ''}</small></span>
        <span class="end">${x.mfaEnabled ? '<span class="chip p">2FA</span>' : '<span class="chip n">No 2FA</span>'}
          ${Can.manageUser(u, x) ? '<span class="chip f">Manage</span>' : ''}</span></button>`).join('')}</div>`,
    Can.createTeacher(u) ? `<button class="btn" data-act="newuser">Create an account</button>` : '');
};

ACTIONS.newuser = async () => {
  const u = App.user;
  const depts = await DB.all('depts');
  const roles = Object.entries(ROLES).filter(([r]) => ROLES[u.role].rank > ROLES[r].rank);
  sheet(`<h2>Create an account</h2>
    <p class="note">An HOD creates teachers inside their own department. A vice principal can create HODs.
    Nobody can create an account at or above their own level.</p>
    <label class="fld"><span>Name</span><input id="nm" placeholder="Prof. A. B. Kulkarni"></label>
    <label class="fld"><span>College email</span><input id="em" type="email" placeholder="name@college.edu.in"></label>
    <div class="row">
      <label class="fld"><span>Role</span><select id="rl">${roles.map(([r, v]) =>
        `<option value="${r}">${v.label}</option>`).join('')}</select></label>
      <label class="fld"><span>Department</span><select id="dp">
        ${depts.map(d => `<option value="${d.id}" ${d.id === u.deptId ? 'selected' : ''}>${esc(d.code)}</option>`).join('')}
      </select></label>
    </div>
    <div class="row"><button class="btn ghost" data-x="c">Cancel</button><button class="btn" data-x="ok">Create</button></div>`,
    el => {
      el.querySelector('[data-x=c]').onclick = closeSheet;
      el.querySelector('[data-x=ok]').onclick = async () => {
        const name = el.querySelector('#nm').value.trim();
        const email = el.querySelector('#em').value.trim().toLowerCase();
        if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('A name and a valid email are needed.');
        if ((await DB.where('users', x => x.email === email)).length) return toast('That email already has an account.');
        const role = el.querySelector('#rl').value;
        const dept = el.querySelector('#dp').value;
        if (u.role === 'hod' && dept !== u.deptId) return toast('You can only add people to your own department.');
        const temp = Math.random().toString(36).slice(2, 10);
        const rec = { id: uid('usr'), name, email, role, deptId: role === 'admin' || role === 'vice' ? null : dept,
          active: true, deviceIds: [], mfaEnabled: false, totpSecret: null,
          pw: await Crypto2.hashPassword(temp), mustSetPassword: true, createdBy: u.id };
        await DB.put('users', rec);
        await Audit.log(u.id, 'user.create', { userId: rec.id, role });
        closeSheet();
        sheet(`<h2>Account created</h2><p>${esc(name)} can sign in with this one-time password:</p>
          <p style="font-size:1.5rem;font-weight:640;letter-spacing:.06em">${esc(temp)}</p>
          <p class="note">They will be asked to change it. Pass it on in person, not over chat.</p>
          <button class="btn" data-x="d">Done</button>`, e2 => {
            e2.querySelector('[data-x=d]').onclick = () => { closeSheet(); render(); };
          });
      };
    });
};

ACTIONS.edituser = async d => {
  const u = App.user, t = await DB.get('users', d.id);
  const self = t.id === u.id;
  const can = Can.manageUser(u, t);
  const depts = await DB.all('depts');
  sheet(`<h2>${esc(t.name)}</h2>
    <dl class="kv">
      <dt>Role</dt><dd>${esc(ROLES[t.role].label)}</dd>
      <dt>Email</dt><dd>${esc(t.email)}</dd>
      <dt>Department</dt><dd>${t.deptId ? esc((await DB.get('depts', t.deptId)).name) : 'College-wide'}</dd>
      <dt>Handsets</dt><dd>${t.deviceIds.length ? t.deviceIds.map(x => x.slice(0, 4).toUpperCase()).join(', ') : 'none registered'}</dd>
      <dt>Two-step</dt><dd>${t.mfaEnabled ? 'on' : 'off'}</dd>
    </dl>
    ${self ? `<button class="btn ghost" data-x="mfa">${t.mfaEnabled ? 'Turn off two-step' : 'Set up two-step verification'}</button>
              <button class="btn ghost" data-x="pw">Change my password</button>` : ''}
    ${can && t.role === 'teacher' ? `<button class="btn ghost" data-x="xfer">Transfer to another department</button>` : ''}
    ${can ? `<label class="fld"><span>Department</span><select id="dp">${depts.map(x =>
        `<option value="${x.id}" ${x.id === t.deptId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <div class="row"><button class="btn ghost" data-x="dev">Clear handsets</button>
      <button class="btn" data-x="save">Save</button></div>` : ''}`, el => {
    el.querySelector('[data-x=mfa]')?.addEventListener('click', () => mfaSheet(t));
    el.querySelector('[data-x=pw]')?.addEventListener('click', () => pwSheet(t));
    el.querySelector('[data-x=xfer]')?.addEventListener('click', () => transferSheet(t));
    el.querySelector('[data-x=dev]')?.addEventListener('click', async () => {
      t.deviceIds = []; await DB.put('users', t);
      await Audit.log(u.id, 'user.devices.clear', { userId: t.id });
      closeSheet(); toast('Handsets cleared. They will re-register on next sign-in.'); render();
    });
    el.querySelector('[data-x=save]')?.addEventListener('click', async () => {
      t.deptId = el.querySelector('#dp').value;
      await DB.put('users', t);
      await Audit.log(u.id, 'user.update', { userId: t.id });
      closeSheet(); toast('Saved.'); render();
    });
  });
};

async function mfaSheet(t) {
  if (t.mfaEnabled) {
    t.mfaEnabled = false; t.totpSecret = null;
    await DB.put('users', t);
    await Audit.log(App.user.id, 'mfa.disable', { userId: t.id });
    closeSheet(); toast('Two-step verification is off.'); return render();
  }
  const secret = Crypto2.newTotpSecret();
  const uri = Crypto2.totpUri(secret, t.email);
  const live = await Crypto2.totp(secret);
  sheet(`<h2>Two-step verification</h2>
    <p class="note">Add this secret to Google Authenticator, Aegis or any TOTP app, then confirm the code.
    These are real RFC 6238 codes — the app is not faking them.</p>
    <p style="font-family:inherit;font-size:1.05rem;font-weight:620;letter-spacing:.09em;word-break:break-all">${esc(secret)}</p>
    <p class="note hashline">${esc(uri)}</p>
    <p class="note">Right now the correct code is <b id="lv">${live}</b> (it changes every 30 seconds).</p>
    <label class="fld"><span>Enter the code from your app</span><input id="otp" inputmode="numeric" maxlength="6"></label>
    <div class="row"><button class="btn ghost" data-x="c">Cancel</button><button class="btn" data-x="ok">Turn on</button></div>`,
    el => {
      const tick = setInterval(async () => {
        const n = el.querySelector('#lv'); if (!n) return clearInterval(tick);
        n.textContent = await Crypto2.totp(secret);
      }, 2000);
      el.querySelector('[data-x=c]').onclick = () => { clearInterval(tick); closeSheet(); };
      el.querySelector('[data-x=ok]').onclick = async () => {
        if (!await Crypto2.totpVerify(secret, el.querySelector('#otp').value)) return toast('That code is not right.');
        clearInterval(tick);
        t.mfaEnabled = true; t.totpSecret = secret;
        await DB.put('users', t);
        await Audit.log(App.user.id, 'mfa.enable', { userId: t.id });
        closeSheet(); toast('Two-step verification is on.'); render();
      };
    });
}

function pwSheet(t) {
  sheet(`<h2>Change password</h2>
    <label class="fld"><span>Current password</span><input type="password" id="a"></label>
    <label class="fld"><span>New password</span><input type="password" id="b"></label>
    <label class="fld"><span>New password again</span><input type="password" id="c2"></label>
    <p class="note">Stored as a PBKDF2-SHA256 derivation over 210,000 iterations with a per-account salt.
    A bare SHA-256 digest would be brute-forceable offline.</p>
    <div class="row"><button class="btn ghost" data-x="c">Cancel</button><button class="btn" data-x="ok">Change</button></div>`,
    el => {
      el.querySelector('[data-x=c]').onclick = closeSheet;
      el.querySelector('[data-x=ok]').onclick = async () => {
        const a = el.querySelector('#a').value, b = el.querySelector('#b').value, c = el.querySelector('#c2').value;
        if (!await Crypto2.verifyPassword(a, t.pw)) return toast('Your current password is wrong.');
        if (b.length < 8) return toast('Use at least 8 characters.');
        if (b !== c) return toast('The two new passwords do not match.');
        t.pw = await Crypto2.hashPassword(b); t.mustSetPassword = false;
        await DB.put('users', t);
        await Audit.log(t.id, 'password.change', {});
        closeSheet(); toast('Password changed.');
      };
    });
}

/* ---------------------------------------------------------
   Requests: cover and transfer
   --------------------------------------------------------- */

function transferSheet(teacher) {
  DB.all('depts').then(depts => {
    DB.all('users').then(users => {
      const targets = depts.filter(d => d.id !== teacher.deptId);
      sheet(`<h2>Transfer ${esc(teacher.name)}</h2>
        <p class="note">The receiving head of department has to accept. Until they do, nothing changes —
        the teacher keeps their current classes.</p>
        <label class="fld"><span>To department</span><select id="d">${targets.map(d =>
          `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label>
        <label class="fld"><span>Effective from</span><input type="date" id="dt" value="${todayISO()}"></label>
        <div class="row"><button class="btn ghost" data-x="c">Cancel</button>
        <button class="btn" data-x="ok">Send request</button></div>`, el => {
        el.querySelector('[data-x=c]').onclick = closeSheet;
        el.querySelector('[data-x=ok]').onclick = async () => {
          const toDept = el.querySelector('#d').value;
          const hod = users.find(u => u.role === 'hod' && u.deptId === toDept);
          if (!hod) return toast('That department has no head of department on record.');
          const r = { id: uid('req'), type: 'transfer', status: 'pending',
            from: App.user.id, to: hod.id, createdAt: Date.now(),
            payload: { teacherId: teacher.id, fromDept: teacher.deptId, toDept, effective: el.querySelector('#dt').value } };
          await DB.put('requests', r);
          await Audit.log(App.user.id, 'request.transfer', { requestId: r.id, teacherId: teacher.id });
          closeSheet(); toast(`Sent to ${hod.name}.`); render();
        };
      });
    });
  });
}

VIEWS.requests = async () => {
  const u = App.user;
  const all = await DB.all('requests');
  const inbox = all.filter(r => r.to === u.id).sort((a, b) => b.createdAt - a.createdAt);
  const sent = all.filter(r => r.from === u.id).sort((a, b) => b.createdAt - a.createdAt);
  const users = Object.fromEntries((await DB.all('users')).map(x => [x.id, x]));
  const ks = Object.fromEntries((await DB.all('klasses')).map(k => [k.id, k]));

  const describe = r => r.type === 'substitute'
    ? `Cover ${esc(ks[r.payload.klassId]?.name || '?')} on ${esc(r.payload.date)}`
    : `Move ${esc(users[r.payload.teacherId]?.name || '?')} to your department`;
  const chip = s => s === 'pending' ? '<span class="chip r">Waiting</span>'
    : s === 'accepted' ? '<span class="chip p">Accepted</span>' : '<span class="chip a">Declined</span>';

  const list = (rows, dir) => rows.length ? `<div class="ledger">${rows.map(r => `
    <button class="lrow" role="button" data-act="openreq" data-id="${esc(r.id)}">
      <span class="who"><b>${describe(r)}</b>
        <small>${dir === 'in' ? 'from ' + esc(users[r.from]?.name || '?') : 'to ' + esc(users[r.to]?.name || '?')}
        · ${new Date(r.createdAt).toLocaleDateString()}</small></span>
      <span class="end">${chip(r.status)}</span></button>`).join('')}</div>`
    : `<div class="empty">Nothing here.</div>`;

  return shell('Requests', `${inbox.filter(r => r.status === 'pending').length} waiting on you`,
    `<div class="view"><h2>For you</h2></div>${list(inbox, 'in')}
     <div class="view"><h2>You sent</h2></div>${list(sent, 'out')}`,
    `<button class="btn" data-act="askcover">Ask someone to cover a class</button>`);
};

ACTIONS.askcover = async () => {
  const u = App.user;
  const slots = await DB.where('timetable', t => t.teacherId === u.id);
  if (!slots.length) return toast('You have no timetable slots to hand over.');
  const ks = Object.fromEntries((await DB.all('klasses')).map(k => [k.id, k]));
  const peers = await DB.where('users', x => x.role === 'teacher' && x.id !== u.id &&
    (u.deptId ? x.deptId === u.deptId : true));
  sheet(`<h2>Ask someone to cover</h2>
    <label class="fld"><span>Which class</span><select id="s">${slots.map(s =>
      `<option value="${esc(s.id)}">${DAYS[s.day]} ${fmtTime(s.start)} — ${esc(ks[s.klassId]?.name || '?')}</option>`).join('')}</select></label>
    <label class="fld"><span>Who</span><select id="w">${peers.map(p =>
      `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
    <div class="row">
      <label class="fld"><span>From</span><input type="date" id="d1" value="${todayISO()}"></label>
      <label class="fld"><span>Until</span><input type="date" id="d2" value="${todayISO()}"></label>
    </div>
    <p class="note">They get access to this class only, and only between those dates. It expires by itself —
    nobody has to remember to revoke it.</p>
    <div class="row"><button class="btn ghost" data-x="c">Cancel</button><button class="btn" data-x="ok">Send</button></div>`,
    el => {
      el.querySelector('[data-x=c]').onclick = closeSheet;
      el.querySelector('[data-x=ok]').onclick = async () => {
        const slotId = el.querySelector('#s').value;
        const slot = slots.find(s => s.id === slotId);
        const r = { id: uid('req'), type: 'substitute', status: 'pending',
          from: u.id, to: el.querySelector('#w').value, createdAt: Date.now(),
          payload: { slotId, klassId: slot.klassId, substituteId: el.querySelector('#w').value,
                     date: el.querySelector('#d1').value, until: el.querySelector('#d2').value } };
        await DB.put('requests', r);
        await Audit.log(u.id, 'request.substitute', { requestId: r.id, slotId });
        closeSheet(); toast('Request sent.'); render();
      };
    });
};

ACTIONS.openreq = async d => {
  const r = await DB.get('requests', d.id);
  const mine = r.to === App.user.id && r.status === 'pending';
  const users = Object.fromEntries((await DB.all('users')).map(x => [x.id, x]));
  sheet(`<h2>${r.type === 'substitute' ? 'Cover request' : 'Transfer request'}</h2>
    <dl class="kv">
      <dt>From</dt><dd>${esc(users[r.from]?.name || '?')}</dd>
      <dt>To</dt><dd>${esc(users[r.to]?.name || '?')}</dd>
      <dt>Status</dt><dd>${esc(r.status)}</dd>
      ${Object.entries(r.payload).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
    </dl>
    ${mine ? `<div class="row"><button class="btn ghost" data-x="no">Decline</button>
      <button class="btn" data-x="yes">Accept</button></div>`
      : '<button class="btn ghost" data-x="c">Close</button>'}`, el => {
    el.querySelector('[data-x=c]')?.addEventListener('click', closeSheet);
    el.querySelector('[data-x=no]')?.addEventListener('click', async () => {
      r.status = 'declined'; r.decidedAt = Date.now();
      await DB.put('requests', r);
      await Audit.log(App.user.id, 'request.decline', { requestId: r.id });
      closeSheet(); render();
    });
    el.querySelector('[data-x=yes]')?.addEventListener('click', async () => {
      r.status = 'accepted'; r.decidedAt = Date.now();
      await DB.put('requests', r);
      if (r.type === 'transfer') {
        const t = await DB.get('users', r.payload.teacherId);
        t.deptId = r.payload.toDept;
        await DB.put('users', t);
        // the teacher's old slots no longer belong to them
        const slots = await DB.where('timetable', s => s.teacherId === t.id);
        for (const s of slots) await DB.del('timetable', s.id);
        await Audit.log(App.user.id, 'transfer.complete',
          { teacherId: t.id, toDept: r.payload.toDept, slotsCleared: slots.length });
      } else {
        await Audit.log(App.user.id, 'substitute.accept', { requestId: r.id, klassId: r.payload.klassId });
      }
      closeSheet(); toast('Accepted.'); render();
    });
  });
};

/* ---------------------------------------------------------
   History and a saved roll
   --------------------------------------------------------- */

VIEWS.history = async () => {
  const u = App.user;
  let ss = await DB.all('sessions');
  if (ROLES[u.role].rank === 1) ss = ss.filter(s => s.teacherId === u.id);
  else if (u.role === 'hod') {
    const ks = new Set((await DB.where('klasses', k => k.deptId === u.deptId)).map(k => k.id));
    ss = ss.filter(s => ks.has(s.klassId));
  }
  ss.sort((a, b) => b.closedAt - a.closedAt);
  const ks = Object.fromEntries((await DB.all('klasses')).map(k => [k.id, k]));
  const us = Object.fromEntries((await DB.all('users')).map(x => [x.id, x]));

  return shell('Attendance history', `${ss.length} roll(s) saved`,
    ss.length ? `<div class="ledger">${ss.map(s => `
      <button class="lrow" role="button" data-act="goto" data-to="sessionview" data-arg='${JSON.stringify({ id: s.id })}'>
        <span class="roll">${esc(String(Math.round(s.present / s.total * 100)))}</span>
        <span class="who"><b>${esc(ks[s.klassId]?.name || '?')}</b>
          <small>${esc(s.date)} · ${esc(us[s.teacherId]?.name || '?')} · ${s.present}/${s.total}${
            s.overrideReason ? ' · out of timetable' : ''}</small></span>
        <span class="end"><span class="chip ${s.engine === 'onnx' ? 'p' : 'n'}">${esc(s.engine)}</span></span></button>`).join('')}</div>`
      : '<div class="empty"><strong>No rolls yet</strong>Take attendance and it will appear here.</div>');
};

VIEWS.sessionview = async ({ id }) => {
  const s = await DB.get('sessions', id);
  const rows = await DB.where('attendance', a => a.sessionId === id);
  const students = Object.fromEntries((await DB.all('students')).map(x => [x.id, x]));
  const k = await DB.get('klasses', s.klassId);
  const teacher = await DB.get('users', s.teacherId);
  const reseal = await sealSession(s, rows);
  const intact = reseal === s.seal;
  rows.sort((a, b) => (students[a.studentId]?.roll || '').localeCompare(students[b.studentId]?.roll || ''));
  const present = rows.filter(r => r.state === 'present').length;

  return shell(k.name, `${s.date} · ${teacher?.name || '?'}`, `
    <div class="view">
      <div class="tally">
        <div class="p"><b>${present}</b><span>Present</span></div>
        <div class="a"><b>${rows.length - present}</b><span>Absent</span></div>
        <div><b>${rows.filter(r => r.source !== 'auto').length}</b><span>Edited by hand</span></div>
      </div>
      <div class="panel">
        <h3>Record seal</h3>
        <p class="note">${intact ? 'This roll matches its seal — nothing has been altered since it was saved.'
          : 'This roll no longer matches its seal. It has been changed since it was saved.'}</p>
        <p class="hashline">${esc(s.seal)}</p>
        <p class="note">${intact ? '<span class="chip p">Intact</span>' : '<span class="chip a">Altered</span>'}
          Engine: ${esc(s.engine)} · threshold ${s.threshold} · ${s.shots} shot(s) · handset ${esc((s.deviceId || '').slice(0, 4).toUpperCase())}</p>
        ${s.overrideReason ? `<p class="note warn">Taken outside the timetable. Reason given: ${esc(s.overrideReason)}</p>` : ''}
      </div>
      <button class="btn ghost" data-act="csv" data-id="${esc(id)}">Download as CSV</button>
    </div>
    <div class="ledger-head"><span class="g">Roll</span><span class="n">Student</span><span>Status</span></div>
    <div class="ledger">${rows.map(r => {
      const st = students[r.studentId] || { name: '?', roll: '?' };
      return `<div class="lrow ${r.state === 'present' ? 's-p' : 's-a'} ${r.source !== 'auto' ? 'edited' : ''}">
        <span class="roll">${esc(st.roll.slice(-3))}</span>
        <span class="who"><b>${esc(st.name)}</b><small>${esc(r.source)}${r.flagged ? ' · was unresolved' : ''}</small></span>
        <span class="end">${r.conf != null ? `<span class="conf">${(r.conf * 100).toFixed(0)}%</span>` : ''}
          ${stateChip(r.state)}</span></div>`;
    }).join('')}</div>`);
};

ACTIONS.csv = async d => {
  const s = await DB.get('sessions', d.id);
  const rows = await DB.where('attendance', a => a.sessionId === d.id);
  const students = Object.fromEntries((await DB.all('students')).map(x => [x.id, x]));
  const k = await DB.get('klasses', s.klassId);
  const csv = toCSV(rows.sort((a, b) => (students[a.studentId]?.roll || '').localeCompare(students[b.studentId]?.roll || '')), [
    { label: 'Roll', get: r => students[r.studentId]?.roll },
    { label: 'Name', get: r => students[r.studentId]?.name },
    { label: 'Status', get: r => r.state },
    { label: 'Marked by', get: r => r.source },
    { label: 'Confidence', get: r => r.conf != null ? r.conf.toFixed(4) : '' },
    { label: 'Needed checking', get: r => r.flagged ? 'yes' : 'no' },
  ]);
  download(`attendance_${k.name.replace(/\W+/g, '_')}_${s.date}.csv`, csv, 'text/csv');
  toast('CSV downloaded.');
};

/* ---------------------------------------------------------
   Testing and settings
   --------------------------------------------------------- */

VIEWS.uat = async () => {
  const c = Settings.cache;
  const eng = App.engine;
  return shell('Testing & settings', eng ? eng.name : '', `
    <div class="view">
      <div class="panel">
        <h3>Recognition engine</h3>
        <div class="seg" style="margin-bottom:.6rem">
          ${['auto', 'onnx', 'synthetic'].map(e =>
            `<button data-act="seteng" data-e="${e}" class="${c.engine === e ? 'on' : ''}">${
              e === 'auto' ? 'Automatic' : e === 'onnx' ? 'Real models' : 'Simulator'}</button>`).join('')}
        </div>
        <p class="note">${esc(eng ? eng.name + (eng.detail ? ' · ' + eng.detail : '') : 'not started')}</p>
        <p class="note">Automatic uses the real models whenever the weight files are present and falls back
        to the simulator otherwise, so the same build demonstrates on any machine.</p>
      </div>

      <div class="panel">
        <h3>Decision thresholds</h3>
        ${[['acceptThreshold', 'Mark present at or above', 0.2, 0.9, 0.01],
           ['reviewThreshold', 'Send to Check at or above', 0.1, 0.7, 0.01],
           ['marginMin', 'Runner-up margin needed', 0, 0.3, 0.01],
           ['minFacePx', 'Smallest usable face (px)', 12, 80, 1],
           ['detScore', 'Detector confidence', 0.1, 0.9, 0.05]].map(([k, label, min, max, step]) => `
          <label class="fld"><span>${label} — <b id="v_${k}">${c[k]}</b></span>
            <input type="range" id="r_${k}" min="${min}" max="${max}" step="${step}" value="${c[k]}"></label>`).join('')}
        <p class="note">Raising the present threshold trades recall for precision. Because a student wrongly
        marked absent is correctable and one wrongly marked present is not, this app is tuned to err high.</p>
      </div>

      <div class="panel">
        <h3>Gate</h3>
        <label class="fld"><span><input type="checkbox" id="c_enforceTimetable" ${c.enforceTimetable ? 'checked' : ''}> Require a timetable slot</span></label>
        <label class="fld"><span><input type="checkbox" id="c_enforceDevice" ${c.enforceDevice ? 'checked' : ''}> Require a registered handset</span></label>
        <div class="row">
          <label class="fld"><span>Open early (min)</span><input type="number" id="n_earlyOpenMin" value="${c.earlyOpenMin}"></label>
          <label class="fld"><span>Grace after (min)</span><input type="number" id="n_lateGraceMin" value="${c.lateGraceMin}"></label>
        </div>
      </div>

      <div class="panel">
        <h3>Simulator</h3>
        <p class="note">Controls the synthetic engine so you can rehearse hard cases without a real class.</p>
        ${[['simSigma', 'Capture noise (higher = harder)', 0.01, 0.2, 0.005, c.simSigma ?? 0.055],
           ['simPresentRate', 'Share of the class attending', 0.3, 1, 0.02, c.simPresentRate ?? 0.86],
           ['simStrangers', 'Faces belonging to nobody', 0, 6, 1, c.simStrangers ?? 1]].map(([k, label, min, max, step, val]) => `
          <label class="fld"><span>${label} — <b id="v_${k}">${val}</b></span>
            <input type="range" id="r_${k}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`).join('')}
        <button class="btn ghost" data-act="sweep">Run a threshold sweep</button>
        <div id="sweep"></div>
      </div>

      <div class="panel">
        <h3>Data</h3>
        <div class="row">
          <button class="btn ghost sm" data-act="expjson">Export everything</button>
          <button class="btn ghost sm" data-act="impjson">Import a file</button>
        </div>
        <div class="row" style="margin-top:.6rem">
          <button class="btn ghost sm" data-act="coachreset">Replay the tips</button>
          <button class="btn danger sm" data-act="reseed">Reset to fresh data</button>
        </div>
        <input type="file" id="impfile" accept="application/json" hidden>
        <p class="note">Export writes a single JSON file containing every student, face descriptor, roll and
        audit entry. It is how you move a demo between handsets.</p>
      </div>
    </div>`);
};

VIEWS['uat:mount'] = async () => {
  const bind = (id, key, fmt = v => v) => {
    const el = document.getElementById('r_' + id);
    if (!el) return;
    el.addEventListener('input', async () => {
      const v = parseFloat(el.value);
      document.getElementById('v_' + id).textContent = fmt(v);
      await Settings.set({ [key]: v });
      if (key.startsWith('sim')) App.engine = null;   // rebuild with new simulator params
    });
  };
  ['acceptThreshold', 'reviewThreshold', 'marginMin', 'minFacePx', 'detScore',
   'simSigma', 'simPresentRate', 'simStrangers'].forEach(k => bind(k, k));
  ['enforceTimetable', 'enforceDevice'].forEach(k => {
    const el = document.getElementById('c_' + k);
    if (el) el.onchange = () => Settings.set({ [k]: el.checked });
  });
  ['earlyOpenMin', 'lateGraceMin'].forEach(k => {
    const el = document.getElementById('n_' + k);
    if (el) el.onchange = () => Settings.set({ [k]: +el.value });
  });
  const f = document.getElementById('impfile');
  if (f) f.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      await importAll(JSON.parse(await file.text()));
      toast('Imported. Sign in again.');
      App.user = null; App.engine = null; go('login', {}, true);
    } catch (err) { toast('Import failed: ' + err.message); }
  };
};

ACTIONS.seteng = async d => {
  await Settings.set({ engine: d.e });
  App.engine = null;
  try { await ensureEngine(true); toast('Using ' + App.engine.name + '.'); }
  catch (e) { toast(e.message); await Settings.set({ engine: 'auto' }); await ensureEngine(true); }
  render();
};
ACTIONS.coachreset = () => { Coach.reset(); go('home', {}, true); };
ACTIONS.expjson = async () => {
  download(`colproj_export_${todayISO()}.json`, JSON.stringify(await exportAll()), 'application/json');
  toast('Exported.');
};
ACTIONS.impjson = () => document.getElementById('impfile').click();
ACTIONS.reseed = async () => {
  if (!await confirmSheet('Reset everything?',
    '<p class="note">Every student, face, roll and audit entry on this handset is deleted and the demo data is rebuilt.</p>',
    'Delete and rebuild', true)) return;
  await seedIfEmpty(true);
  App.user = null; App.engine = null; App.stack = [];
  toast('Fresh data ready.');
  go('login', {}, true);
};

/* A sweep over the accept threshold using the simulator, so a reviewer can see
   the precision/recall trade-off rather than being told about it. */
ACTIONS.sweep = async () => {
  const out = document.getElementById('sweep');
  out.innerHTML = '<p class="note">Running…</p>';
  const roster = (await rosterOf((await DB.all('klasses'))[0].id)).slice(0, 60);
  const sigma = Settings.get('simSigma') ?? 0.055;
  const gallery = new Gallery();
  gallery.items = roster.map(s => ({ studentId: s.id, templateId: 't' + s.id, emb: identityVector(s.id) }));

  const trials = [];
  roster.forEach((s, i) => {
    if (i % 7 === 3) return;                                   // absentees: no face in the room
    trials.push({ truth: s.id, emb: perturb(identityVector(s.id), sigma, mulberry(hash32(s.id + 'sweep'))) });
  });
  for (let i = 0; i < 6; i++)                                   // outsiders who are on nobody's roll
    trials.push({ truth: null, emb: perturb(identityVector('outsider' + i), sigma, mulberry(i + 99)) });

  const rows = [];
  for (let th = 0.20; th <= 0.75001; th += 0.05) {
    const cfg = { acceptThreshold: th, reviewThreshold: Math.min(th - 0.01, Settings.get('reviewThreshold')), marginMin: Settings.get('marginMin') };
    let tp = 0, fp = 0, fn = 0;
    for (const t of trials) {
      const m = gallery.match(t.emb, cfg);
      const claimed = m.band === 'accept' ? m.top.studentId : null;
      if (claimed && claimed === t.truth) tp++;
      else if (claimed) fp++;
      else if (t.truth) fn++;
    }
    rows.push({ th, tp, fp, fn,
      prec: tp + fp ? tp / (tp + fp) : 1,
      rec: tp + fn ? tp / (tp + fn) : 0 });
  }
  const cur = Settings.get('acceptThreshold');
  out.innerHTML = `
    <div class="ledger-head" style="margin-top:.6rem"><span class="g">Thr</span>
      <span class="n">Auto-marked correctly</span><span>Wrongly present</span></div>
    <div class="ledger">${rows.map(r => `
      <div class="lrow ${r.fp ? 's-a' : 's-p'}" style="padding-inline:0">
        <span class="roll">${r.th.toFixed(2)}</span>
        <span class="who"><b>${(r.rec * 100).toFixed(0)}% of those present</b>
          <small>precision ${(r.prec * 100).toFixed(1)}% · ${r.fn} sent for checking</small></span>
        <span class="end">${r.fp ? `<span class="chip a">${r.fp}</span>` : '<span class="chip p">0</span>'}
        ${Math.abs(r.th - cur) < 0.026 ? '<span class="chip f">now</span>' : ''}</span></div>`).join('')}</div>
    <p class="note" style="margin-top:.5rem">${trials.length} simulated faces, ${roster.length} on the roll,
    noise σ=${sigma}. The rows where “wrongly present” is zero are the ones worth deploying at.</p>`;
};

/* ---------------------------------------------------------
   Integrity
   --------------------------------------------------------- */

VIEWS.audit = async () => {
  const res = await Audit.verify();
  const rows = (await DB.all('audit')).sort((a, b) => b.seq - a.seq).slice(0, 80);
  const users = Object.fromEntries((await DB.all('users')).map(x => [x.id, x]));
  const sessions = await DB.all('sessions');
  let sealsOk = 0;
  for (const s of sessions) {
    const r = await DB.where('attendance', a => a.sessionId === s.id);
    if (await sealSession(s, r) === s.seal) sealsOk++;
  }

  return shell('Record integrity', `${res.total} entries`, `
    <div class="view">
      <div class="panel">
        <h3>Audit chain</h3>
        <p class="note">Every entry carries a SHA-256 over its own contents plus the hash before it.
        Editing any past entry breaks every hash after it, which this check finds.</p>
        <p>${res.ok ? '<span class="chip p">Unbroken</span>' : `<span class="chip a">Broken at entry ${res.brokenAt}</span>`}</p>
        ${res.head ? `<p class="hashline">head ${esc(res.head)}</p>` : ''}
      </div>
      <div class="panel">
        <h3>Saved rolls</h3>
        <p>${sealsOk === sessions.length ? '<span class="chip p">All intact</span>' : `<span class="chip a">${sessions.length - sealsOk} altered</span>`}
        ${sealsOk} of ${sessions.length} match their seal.</p>
      </div>
    </div>
    <div class="ledger">${rows.map(e => `
      <div class="lrow">
        <span class="roll">${e.seq}</span>
        <span class="who"><b>${esc(e.action)}</b>
          <small>${esc(users[e.actor]?.name || e.actor)} · ${new Date(e.ts).toLocaleString()}</small></span>
        <span class="end"><span class="conf">${esc(e.hash.slice(0, 6))}</span></span></div>`).join('')}</div>`);
};
