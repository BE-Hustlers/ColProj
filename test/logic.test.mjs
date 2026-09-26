import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ console, crypto: globalThis.crypto, Math, Float32Array, Uint8Array,
  TextEncoder, Map, Set, Array, Object, JSON, Date, String, Number, fetch: async () => ({ ok: false }),
  indexedDB: undefined, localStorage: { getItem: () => null, setItem: () => {} },
  document: { createElement: () => ({ getContext: () => ({}) }) } });

// Classic <script> tags share one global lexical scope in a browser, but a vm
// script's class/const bindings stay script-local, so re-publish them here.
const publish = names => '\n;' + names.map(n => `globalThis.${n}=${n};`).join('');
vm.runInContext(fs.readFileSync('www/js/engine.js', 'utf8') +
  publish(['Gallery', 'OnnxEngine', 'SyntheticEngine', 'FixtureEngine', 'ARC_TEMPLATE', 'EMB_DIM']), ctx);
// core.js defines Crypto2 etc.; it references indexedDB only lazily.
vm.runInContext(fs.readFileSync('www/js/core.js', 'utf8') +
  publish(['Crypto2', 'DB', 'Settings', 'DEFAULTS', 'Can', 'ROLES', 'Audit']), ctx);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL ${name}  ${extra}`); }
};

console.log('\n— geometry —');
{
  const { similarityTransform } = ctx;
  // pure translation
  let M = similarityTransform([[0,0],[1,0],[0,1]], [[5,7],[6,7],[5,8]]);
  ok('translation recovered', Math.abs(M[0]-1)<1e-6 && Math.abs(M[2]-5)<1e-6 && Math.abs(M[5]-7)<1e-6);
  // 90 deg rotation + 2x scale about origin
  M = similarityTransform([[1,0],[0,1]], [[0,2],[-2,0]]);
  ok('rotation+scale recovered', Math.abs(M[0])<1e-6 && Math.abs(M[3]-2)<1e-6, `m00=${M[0].toFixed(4)} m10=${M[3].toFixed(4)}`);
}

console.log('\n— simulator statistics —');
{
  const { identityVector, perturb, cosine, mulberry, hash32 } = ctx;
  const ids = Array.from({length: 300}, (_, i) => identityVector('stu_' + i));
  let s = 0, s2 = 0, n = 0, mx = 0;
  for (let i = 0; i < 300; i++) for (let j = i+1; j < 300; j++) {
    const c = cosine(ids[i], ids[j]); s += c; s2 += c*c; n++; mx = Math.max(mx, Math.abs(c));
  }
  const mean = s/n, sd = Math.sqrt(s2/n - mean*mean);
  ok('impostor cos ~ 0', Math.abs(mean) < 0.01, `mean=${mean.toFixed(4)}`);
  ok('impostor sd ~ 1/sqrt(512)=0.0442', Math.abs(sd - 0.0442) < 0.006, `sd=${sd.toFixed(4)}`);
  ok('no impostor pair reaches 0.32 review floor', mx < 0.32, `max=${mx.toFixed(4)}`);

  for (const sigma of [0.03, 0.055, 0.09]) {
    let t = 0;
    for (let i = 0; i < 300; i++) t += cosine(ids[i], perturb(ids[i], sigma, mulberry(hash32('p'+i))));
    const got = t/300, theory = 1/Math.sqrt(1 + 512*sigma*sigma);
    ok(`genuine cos at sigma=${sigma}`, Math.abs(got - theory) < 0.02,
       `got=${got.toFixed(3)} theory=${theory.toFixed(3)}`);
  }
}

console.log('\n— matcher bands —');
{
  const { Gallery, identityVector, perturb, mulberry, hash32 } = ctx;
  const cfg = { acceptThreshold: 0.45, reviewThreshold: 0.32, marginMin: 0.04 };
  const g = new Gallery();
  const roll = Array.from({length: 50}, (_, i) => 'stu_' + i);
  g.items = roll.map(id => ({ studentId: id, templateId: 't_'+id, emb: identityVector(id) }));

  const clean = g.match(perturb(identityVector('stu_7'), 0.03, mulberry(1)), cfg);
  ok('clean capture accepts', clean.band === 'accept' && clean.top.studentId === 'stu_7',
     `band=${clean.band} cos=${clean.top.score.toFixed(3)}`);

  // cos(sigma) = 1/sqrt(1+512*sigma^2); the 0.45 accept line sits at sigma ~ 0.088
  const noisy = g.match(perturb(identityVector('stu_7'), 0.105, mulberry(2)), cfg);
  ok('degraded capture drops to review', noisy.band === 'review',
     `band=${noisy.band} cos=${noisy.top.score.toFixed(3)}`);
  const ruined = g.match(perturb(identityVector('stu_7'), 0.28, mulberry(3)), cfg);
  ok('badly degraded capture is rejected, not guessed', ruined.band === 'reject',
     `band=${ruined.band} cos=${ruined.top.score.toFixed(3)}`);

  const stranger = g.match(identityVector('outsider_xyz'), cfg);
  ok('stranger is rejected, never auto-present', stranger.band === 'reject',
     `band=${stranger.band} cos=${stranger.top.score.toFixed(3)}`);

  // an off-roll student must not be attributed to anyone on the roll
  let leaks = 0;
  for (let i = 0; i < 400; i++) {
    const r = g.match(perturb(identityVector('visitor_' + i), 0.03, mulberry(i)), cfg);
    if (r.band === 'accept') leaks++;
  }
  ok('400 off-roll faces produce zero false presents', leaks === 0, `leaks=${leaks}`);

  // margin guard: a vector equidistant between two identities must not auto-commit
  const a = identityVector('stu_1'), b = identityVector('stu_2');
  const mid = new Float32Array(512);
  for (let i = 0; i < 512; i++) mid[i] = a[i] + b[i];
  let nn = 0; for (let i = 0; i < 512; i++) nn += mid[i]*mid[i];
  nn = Math.sqrt(nn); for (let i = 0; i < 512; i++) mid[i] /= nn;
  const amb = g.match(mid, cfg);
  ok('ambiguous face blocked by margin guard', amb.band !== 'accept',
     `band=${amb.band} cos=${amb.top.score.toFixed(3)} margin=${amb.margin.toFixed(4)}`);
}

console.log('\n— cryptography —');
{
  const { Crypto2 } = ctx;
  // RFC 6238 vector: ASCII "12345678901234567890", T=59s, SHA-1 -> 94287082 (8 digits)
  const secret = Crypto2.b32encode(new TextEncoder().encode('12345678901234567890'));
  ok('base32 round-trips', new TextDecoder().decode(Crypto2.b32decode(secret)) === '12345678901234567890');
  const code8 = await Crypto2.totp(secret, 59 * 1000, 30, 8);
  ok('RFC 6238 test vector (T=59)', code8 === '94287082', `got=${code8}`);
  const code8b = await Crypto2.totp(secret, 1111111109 * 1000, 30, 8);
  ok('RFC 6238 test vector (T=1111111109)', code8b === '07081804', `got=${code8b}`);

  const rec = await Crypto2.hashPassword('colproj');
  ok('PBKDF2 verifies the right password', await Crypto2.verifyPassword('colproj', rec));
  ok('PBKDF2 rejects the wrong password', !(await Crypto2.verifyPassword('colproj1', rec)));
  ok('PBKDF2 uses >=210k iterations', rec.iters >= 210000, `iters=${rec.iters}`);
  const rec2 = await Crypto2.hashPassword('colproj');
  ok('salts differ between users with the same password', rec.hash !== rec2.hash);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
