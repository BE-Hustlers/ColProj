/* Boots the built single-file artefact end to end. */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

const html = fs.readFileSync('dist/colproj.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/',
  beforeParse(w) {
    const d = (k, v) => Object.defineProperty(w, k, { value: v, writable: true, configurable: true });
    d('TextEncoder', TextEncoder); d('TextDecoder', TextDecoder);
    d('crypto', webcrypto); d('indexedDB', indexedDB); d('IDBKeyRange', IDBKeyRange);
    d('fetch', async () => ({ ok: false, status: 404 }));
    w.navigator.mediaDevices = { getUserMedia: async () => { throw new Error('NotAllowedError'); } };
    w.scrollTo = () => {};
    const oc = w.document.createElement.bind(w.document);
    w.document.createElement = tag => { const el = oc(tag);
      if (tag === 'canvas') { el.getContext = () => ({ drawImage(){}, fillRect(){}, setTransform(){},
        getImageData: (x,y,cw,ch) => ({ data: new Uint8ClampedArray(cw*ch*4) }), set fillStyle(v){} });
        el.toDataURL = () => 'data:,'; }
      return el; };
  } });

const w = dom.window;
await new Promise(r => setTimeout(r, 1200));
let pass = 0, fail = 0;
const ok = (n, c, x='') => { c ? (pass++, console.log(`  ok   ${n}${x?'  '+x:''}`)) : (fail++, console.log(`  FAIL ${n}  ${x}`)); };

const app = w.document.getElementById('app');
ok('built file boots without throwing', !app.textContent.includes('Could not start'), app.textContent.slice(0,90));
ok('lands on the sign-in screen', app.textContent.includes('ColProj') && !!app.querySelector('#who'));
ok('accounts are populated', app.querySelectorAll('#who option').length > 8,
   `${app.querySelectorAll('#who option').length} accounts`);
ok('no external resources referenced', !/<(script[^>]+src|link[^>]+href)=/.test(html));

app.querySelector('#pw').value = 'colproj';
app.querySelector('#who').value = 'usr_t1';
app.querySelector('[data-act=signin]').click();
await new Promise(r => setTimeout(r, 900));
const t2 = w.document.getElementById('app').textContent;
ok('signs in and reaches the home screen', /Recognition|class/i.test(t2), t2.slice(0, 80));
ok('shows the live timetable slot', /On now|Take attendance/.test(t2));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
