# ColProj — Manual

Everything the application does, screen by screen, for the people who will use
it and the people who will demonstrate it.

For architecture and code, see `docs/CONTEXT.md`.
For build and deployment, see `README.md`.

---

## Contents

1. [What the app is for](#1-what-the-app-is-for)
2. [Who can do what](#2-who-can-do-what)
3. [Signing in](#3-signing-in)
4. [The home screen](#4-the-home-screen)
5. [Enrolling faces](#5-enrolling-faces)
6. [Taking attendance](#6-taking-attendance)
7. [Checking the roll](#7-checking-the-roll)
8. [Correcting a mistake, and what the app learns](#8-correcting-a-mistake-and-what-the-app-learns)
9. [Classes and students](#9-classes-and-students)
10. [Timetable](#10-timetable)
11. [People and accounts](#11-people-and-accounts)
12. [Cover and transfer requests](#12-cover-and-transfer-requests)
13. [History and exports](#13-history-and-exports)
14. [Testing and settings](#14-testing-and-settings)
15. [Record integrity](#15-record-integrity)
16. [Running a demo](#16-running-a-demo)
17. [Troubleshooting](#17-troubleshooting)
18. [Glossary](#18-glossary)

---

## 1. What the app is for

A teacher photographs their class, and the app marks the roll.

It runs entirely on the handset. There is no server, no login to anything
external, and no network traffic. Students, face descriptors, timetables and
attendance records all live in the phone's own storage.

The design rule that shapes everything else: **the app never guesses.** A
student is marked present only when the match is confident and unambiguous.
Everything else is handed to the teacher. This costs a little time per class
and buys a record that can be defended.

---

## 2. Who can do what

Four levels. Each one contains the level below it.

| Role | Scope | Can create | Notable powers |
|---|---|---|---|
| **Principal** | Whole college | Vice principals, HODs, teachers | Everything |
| **Vice principal** | Whole college | HODs, teachers | Everything except touching the principal's account |
| **Head of department** | Own department | Teachers in own department | Edit rosters, open classes outside the timetable, approve transfers in |
| **Teacher** | Own timetabled classes | Nobody | Take attendance, enrol faces, edit own timetable, request cover |

Rules enforced in code, not just in the interface:

- Nobody can create or manage an account at or above their own level.
- An HOD can only act on people and classes in their own department.
- A teacher sees only the classes they are timetabled for, plus any class they
  have been accepted as a substitute for.
- Rosters are edited by HODs and above. Teachers do not add or remove students.

If a button is missing from your screen, it is because your role does not have
that power. The app hides what you cannot do rather than showing it and
refusing.

---

## 3. Signing in

Pick your account, enter your password, tap **Sign in**.

Seeded demo accounts all use the password `colproj`. Real accounts get a
one-time password from whoever created them, and are asked to change it.

**Your handset gets registered.** The first time you sign in on a phone, that
phone is attached to your account. Attendance can then only be taken from a
registered handset. This is what stops someone marking a class from home. An
HOD can clear your registered handsets from the People screen if you change
phones.

**Two-step verification** is optional and off by default. Turn it on from
People → your own name → *Set up two-step verification*. The app shows a secret
and an `otpauth://` URI; add either to Google Authenticator, Aegis, or any TOTP
app, then type the current code to confirm. These are real RFC 6238 codes — the
app is not simulating them, and the same secret works in any standard
authenticator.

To change your password: People → your own name → *Change my password*.
Minimum eight characters.

---

## 4. The home screen

The top panel is the only thing that matters most of the time. It shows one of
two states.

**A class is open.** Your timetable says you are teaching right now, you are on
a registered handset, and the clock agrees. The panel names the class, the
subject, the time, and how many of its students have a face on file. One button:
**Take attendance**.

If the panel says *you are covering this class*, you are here through an
accepted cover request rather than your own timetable.

**No class is open.** The panel explains exactly why — nothing scheduled today,
next class at 2:30, or this handset is not registered to you. If you need to
proceed anyway, **Open a class anyway** lets you pick a class and type a reason.
That reason is written to the audit log against your name and your handset. It
is not a back door; it is a recorded exception.

Below that is the recognition panel, which tells you whether real models or the
simulator are running, and then the list of everything else.

---

## 5. Enrolling faces

Nothing works until students have faces on file. This is the single biggest
determinant of how well the app performs.

Classes → pick a class → **Enrol faces**.

Choose the student from the dropdown. Students already done are marked with a
tick. Take photos with the camera, or tap **Use photos from the gallery** to
pull existing images in. Tap any thumbnail to remove it. Tap **Save face**.

The app finds the largest face in each photo — the subject, not a bystander in
the background — aligns it to a standard 112×112 crop, and stores a 512-number
descriptor. The original photograph is not kept.

**What to aim for.** Four or five images per student with genuine variation:
straight on, slightly turned, and at least one in the lighting the classroom
actually has. Variation matters far more than count. Twenty near-identical
frames are worth less than four different ones, because the model is frozen —
it is not being retrained, so the only thing improving is the range of
appearances it has on file for that person.

**What to avoid.** Group photos where you are not certain which face is which.
A wrong face saved at enrolment is worse than no face at all, because it will
confidently match the wrong person forever.

You can see and remove every stored face from the student's own page.

---

## 6. Taking attendance

Home → **Take attendance**.

The camera opens with vertical guides across the frame and a badge reading
*Column 1 of 3*.

**Shoot column by column.** This is the part people skip and then wonder why
the back row never gets recognised. A single wide photo of a sixty-seat room
leaves back-row faces twenty to forty pixels across, which is below the point
where the descriptors separate reliably. Three overlapping shots, panning left
to right, give every face enough pixels to work with.

Aim at the highlighted column and tap **Take shot**. The badge advances. Take
as many as you like — the app merges them and never counts anyone twice. Tap a
thumbnail to discard and retake it.

No camera available, or demonstrating from existing photos? **Use photos from
the gallery** does the same thing with files.

When the shots look right, tap **Analyse**. A sweep animation runs while the
app finds faces, reads each one, and matches them against the enrolled students
for that class only — never against the whole college.

**Mark by hand** skips recognition entirely and gives you a plain roll where
everyone starts absent and you tap names. This is the fallback, and it is always
available. Early on, while the face database is still thin, it is the sensible
default for classes with few enrolments.

---

## 7. Checking the roll

Three counts at the top: **Present**, **Check**, **Absent**.

Three outcomes, not two, and this is deliberate. **Check** means the app found
somebody who looks like this student but is not confident enough to commit —
either the match was weak, or two students scored close enough together that
picking one would be a guess. Those go to you rather than into the record.

The roll below is an attendance register: roll number in the left gutter, name,
then the match confidence, the face it matched, and the status. A coloured bar
on the left edge shows the state at a glance. Rows you have edited by hand are
marked *edited*.

Tap any student to change their status: Present, Check, or Absent. The sheet
also shows the other candidates the app considered, with their scores, which is
useful when two students genuinely do look alike.

Above the roll, if any faces could not be placed, is a strip of them. These are
faces the app found in the room but could not confidently attribute — a student
whose enrolment photos do not cover today's appearance, somebody from another
class who wandered in, or a face too small to use. Faces below the size floor
(26 pixels by default) are shown but never guessed at.

**Reset** puts everyone back to absent without deleting anything the app has
learned.

**Save roll** writes the record. If students are still on Check, the app asks
first and explains that they will be saved as absent-but-flagged. Saved rolls
are sealed — see [Record integrity](#15-record-integrity).

---

## 8. Correcting a mistake, and what the app learns

This is the part worth understanding properly.

When the app marks someone absent who is actually sitting there, tap their face
in the unplaced strip, then tap their name in the roll. A confirmation sheet
appears showing the face crop side by side with the student's name and how close
the nearest existing match was.

Confirm, and two things happen: the student is marked present, and that face is
added to their profile so it is recognised next time. A student who grew a beard
since enrolment needs this once, and then works normally.

**The safeguards, and why they exist.** Adding faces to profiles at runtime is
the mechanism that makes the system improve, and it is also the mechanism that
can quietly destroy it. If a teacher taps the wrong row, one student's face is
written into another student's profile, and from then on the app confidently
confuses them. So:

- The crop is always shown next to the name before anything is written. You
  approve a specific face going to a specific person, not an abstract action.
- Every addition records who approved it, when, and in which session.
- Every added face is individually removable from the student's page. Removing
  one does not alter any attendance already recorded.
- Each student holds at most eight faces. When full, the oldest *learned* face
  retires. Faces added during enrolment are never evicted.
- If the face is small, the sheet warns you, because adding a blurry face can
  make future matching worse rather than better.

If you realise later that a correction was wrong: the student's page →
find the face → **Remove**. That is the undo.

---

## 9. Classes and students

Home → **Classes** shows every class in your scope with its enrolment progress.
A class showing *No faces* will recognise nobody.

Open a class for its full roster, each student showing how many faces they have
on file. Tap a student for their page: their faces, who added each one and when,
their attendance percentage, and buttons to add or remove faces.

**Adding a student** (HOD and above) asks for a name, a roll number, and
whether they joined in first year or directly into second year. Direct
second-year admissions are added exactly like anyone else; the joining date is
recorded so their absence from first-year records is not mistaken for a gap.
Enrol their faces the same way and they work immediately.

---

## 10. Timetable

Home → **Timetable**. Teachers see their own; HODs and above see the whole
department.

**Add a class slot** asks for the class, subject, teacher, day, and start and
end times. The app refuses overlapping slots for the same teacher and refuses an
end time that is not after the start.

Tap an existing slot to edit or delete it.

The timetable is not decoration — it is the mechanism that decides which class
opens when you tap *Take attendance*, so it needs to be right. By default a
slot opens ten minutes early and stays open fifteen minutes past its end. Both
windows are adjustable in Testing and settings.

---

## 11. People and accounts

Home → **People**. HODs see their own department; vice principals and the
principal see everyone.

**Create an account** asks for a name, college email, role and department. The
role dropdown only offers roles below your own. An HOD can only place people in
their own department. The app generates a one-time password and shows it once —
pass it on in person, not over chat.

Tap any person to see their role, department, registered handsets and two-step
status. Depending on your level you can change their department, clear their
registered handsets, or start a transfer.

On your own account you can set up two-step verification and change your
password.

---

## 12. Cover and transfer requests

Home → **Requests** shows what is waiting on you and what you have sent.

**Cover.** A teacher who will be away taps *Ask someone to cover a class*,
picks the slot, the colleague, and a date range. The colleague sees it in their
Requests and accepts or declines. On acceptance they get access to that one
class, only between those dates. It expires by itself — nobody has to remember
to revoke it. While covering, their home screen says *you are covering this
class*.

**Transfer.** An HOD moving a teacher to another department opens that
teacher's page and taps *Transfer to another department*, choosing the
destination and an effective date. The receiving HOD sees the request. Until
they accept, nothing changes and the teacher keeps their classes. On acceptance
the teacher's department is updated and their old timetable slots are cleared,
since those classes are no longer theirs. The number of slots cleared is written
to the audit log.

---

## 13. History and exports

Home → **Attendance history** lists saved rolls, most recent first, with the
attendance percentage in the gutter. Teachers see their own; HODs see their
department's; vice principals and the principal see everything.

Open any roll for the full record: counts, how many rows were edited by hand,
the seal, which engine produced it, the threshold in force at the time, how many
shots were taken, and which handset. If the roll was taken outside the
timetable, the reason given is shown.

**Download as CSV** gives roll number, name, status, who marked it, the
confidence score, and whether the row needed checking. That last column is
worth keeping — it tells you which records a human actually looked at.

---

## 14. Testing and settings

HOD and above. This screen exists so the app's behaviour can be demonstrated
and interrogated rather than taken on trust.

**Recognition engine.** *Automatic* uses the real models whenever the weight
files are present and falls back to the simulator otherwise, which is why the
same build works on a laptop with no models and a phone with them. *Real models*
and *Simulator* force the choice.

**Decision thresholds.**

| Setting | Default | What it does |
|---|---|---|
| Mark present at or above | 0.45 | Match score needed to auto-mark present |
| Send to Check at or above | 0.32 | Below this, the face is not attributed at all |
| Runner-up margin needed | 0.04 | How far ahead the best match must be from the second |
| Smallest usable face | 26 px | Below this, never auto-matched |
| Detector confidence | 0.45 | How sure the detector must be that it found a face |

Raising the present threshold trades recall for precision. The app ships tuned
high, because a student wrongly marked absent is corrected in seconds and one
wrongly marked present is not detectable at all.

**Gate.** Turn the timetable requirement or the handset requirement off for
testing. Adjust how early a slot opens and how long the grace period runs.
Both requirements should be on in real use.

**Simulator.** Capture noise, the share of the class attending, and how many
faces belong to nobody on the roll. Turning noise up simulates a harder room.

**Run a threshold sweep** is the one to show a reviewer. It runs a full
simulated class at thresholds from 0.20 to 0.75 and reports, at each one, what
share of present students were caught automatically, the precision, how many
went for checking, and — the column that matters — how many were **wrongly
marked present**. The rows where that column is zero are the ones worth
deploying at. This demonstrates the trade-off rather than asserting it.

**Data.** *Export everything* writes one JSON file containing every student,
face descriptor, timetable, roll and audit entry. *Import a file* replaces the
current contents with it. *Replay the tips* brings back the walkthrough
overlays. *Reset to fresh data* deletes everything and rebuilds the demo
dataset.

> **Moving enrolments between handsets.** This is how you do it, and it is not
> obvious from anywhere else in the app. Whoever enrols the dataset can work on
> any device — a laptop is easier for bulk enrolment from gallery photos. When
> done, *Export everything*, move the JSON across however you like, and
> *Import a file* on the demo handset. You do not all need to enrol on the same
> phone, and you get a backup for free. Keep a copy of that export somewhere
> safe once the dataset is good: it is the only thing in the project that
> cannot be regenerated from source.

> **Do not tap *Reset to fresh data* after you have built your dataset.** It
> deletes every enrolled face on the handset with one confirmation. It sits in
> the same panel as the export button. If someone else is demonstrating the
> Testing screen, make sure they know what that button does.

> **Exported files are personal data.** The JSON holds a face descriptor for
> every enrolled person. It is not a photograph and cannot be turned back into
> one, but it should not go into a public repository, a shared Drive folder, or
> a group chat. The project's `.gitignore` already excludes it.

---

## 15. Record integrity

Home → **Record integrity**.

**The audit chain.** Every significant action writes an entry carrying a
SHA-256 hash over its own contents plus the hash of the entry before it. Editing
any past entry breaks every hash after it. This screen recomputes the whole
chain and reports either *Unbroken* or the exact entry where it breaks.

**Saved rolls.** Each saved roll carries a seal: a SHA-256 over the full
attendance record. The screen re-derives every seal and reports how many still
match. A single flipped mark, anywhere in any roll, shows up as *Altered*.

Below is the recent audit log — action, who, when, and the first characters of
the hash.

This does not make records impossible to change; anyone with the device can
change the underlying data. It makes changes **impossible to hide**, which is
the achievable property and the one that matters in a dispute.

---

## 16. Running a demo

A sequence that shows the whole system in about eight minutes.

1. **Sign in as Prof. V. D. Sawant.** The seed guarantees this teacher always
   has a class open right now, so the demo never opens on *nothing scheduled*.
2. **Point at the home panel.** The class opened because the timetable, the
   clock and this handset all agreed. Nobody chose it from a list.
3. **Sign out and in as a different teacher** to show the gate refusing, with
   its reason. Then *Open a class anyway*, type a reason, and note it is logged.
4. **Enrol two or three faces** so the mechanism is visible.
5. **Take attendance** — three column shots, then Analyse.
6. **Stop on the three counts.** Explain why Check exists and why the app
   refuses to guess.
7. **Correct one face** from the unplaced strip. Show the confirmation sheet,
   confirm, then open that student's page and show the new face, who added it,
   and the Remove button. This is the answer to "what if the teacher taps
   wrong."
8. **Save the roll**, then open Record integrity and show the chain unbroken.
9. **Testing → Run a threshold sweep.** Point at the *wrongly present* column.
10. **Close on what is deliberately not done** — liveness, consent, ERP — from
    the list in the README. Volunteering the gaps reads better than being caught
    by them.

Before any demo: check enrolment counts on the class you will use, take one
practice run, and have gallery photos ready in case the camera misbehaves.

---

## 17. Troubleshooting

**The camera does not open.** Camera access needs a secure context. The APK and
`localhost` qualify; a plain `http://192.168.x.x` address does not. Use the APK,
or *Use photos from the gallery*, which works everywhere.

**Everyone comes out absent.** Almost always no faces enrolled for that class —
Classes will show *No faces*. Otherwise check the engine panel: if the simulator
is running on a class with real enrolments, the descriptors will not correspond.

**The back row is never recognised.** One wide shot instead of column shots.
Reshoot in three passes. If it persists, the room may simply be too deep for the
phone's camera; lower *Smallest usable face* only if you accept more faces going
to Check.

**Two students keep being confused.** Open both pages and check nobody's face
was saved onto the wrong profile. Remove any suspect face and re-enrol. Raising
the runner-up margin pushes ambiguous pairs to Check rather than guessing.

**"No class scheduled."** Check the timetable day and time, that you are signed
in as the right teacher, and that this handset is registered. The message says
which of these failed.

**"This handset is not registered."** Ask an HOD to clear your handsets from
People, then sign in again.

**A two-step code is rejected.** The phone's clock is out of sync. TOTP allows
about thirty seconds either side; beyond that, fix the device time.

**Could not start.** The app needs IndexedDB, which some browsers block in
private-browsing windows. Use a normal window or the APK.

**Everything looks wrong after an import.** Import replaces everything. Reset to
fresh data and re-import a known-good export.

**The camera stopped working in the APK after a rebuild.** The `android/`
folder is regenerable and therefore disposable. If it was deleted and
`npx cap add android` was run again, the `CAMERA` permission line in
`AndroidManifest.xml` is gone. Add it back and rebuild.

**A change to the app did not appear in the APK.** `npm run android:sync` has
to run before the APK is rebuilt; it copies `www/` into the Android project.
Building without it rebuilds the previous code.

**All the enrolled faces have vanished.** Almost certainly *Reset to fresh
data*. Re-import your export. If there is no export, they are gone — the data
lives only on that handset.

---

## 18. Glossary

**Accept threshold** — the match score at which a student is auto-marked
present.

**ArcFace** — the face recognition model. Turns an aligned face into 512
numbers such that the same person's faces land close together.

**Audit chain** — the tamper-evident log where each entry hashes the one before.

**Check** — the third outcome. A face the app found but will not commit to.

**Cosine / match score** — how close two descriptors are, from -1 to 1. Same
person typically 0.5 to 0.98; different people around 0.

**Descriptor / template / embedding** — the 512 numbers representing one face.
Not a photograph and not reversible into one.

**Detector** — the model that finds where faces are in a photo. SCRFD here.

**Gate** — the check that teacher, handset and clock agree with a timetable slot
before a class opens.

**Gallery** — the set of enrolled descriptors for one class, which a capture is
matched against.

**Margin** — how far the best match leads the second best. A small margin means
ambiguity, so the app sends it to Check.

**Seal** — the SHA-256 over a saved roll, used to prove it has not been altered.

**Simulator** — the engine that runs without model weights, using deterministic
synthetic identities with the same statistical separation as the real models.
