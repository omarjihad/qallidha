// اختبار اللعب العشوائي (بدون متصفح): اللي يدورون بنفس الوقت ينجمعون بغرفة وحدة، العد التنازلي يبدي اللعبة لوحده،
// الغرفة المليانة أو اللي بدت ما تنعطى لحد، الغرفة الغلط تنشال، وبعد النهاية ترجع غرفة انتظار وتبدي من جديد.
//   node tools/quick-test.mjs
import { mulawEncode } from '../public/js/dsp.js';
import { T, MAX_PLAYERS } from '../public/js/shared.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
let ok = 0;
let bad = 0;
const check = (cond, label) => {
  if (cond) ok++;
  else bad++;
  log(cond ? '✅' : '❌', label);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, body) => fetch(BASE + path, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
const run = Date.now().toString(36);

function tone(seconds, f) {
  const n = Math.floor(seconds * 16000);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * f * i) / 16000) * Math.min(1, i / 800, (n - i) / 800);
  return x;
}

let seq = 0;
class Bot {
  constructor(name) {
    this.name = name;
    this.i = seq++;
    this.auth = { guestId: `qk${run}${this.i}x`, guestName: name };
    this.done = {};
    this.st = null;
    this.err = null;
    this.starts = 0;
  }
  async quick(extra = {}) {
    const r = await post('/api/quick', { ...this.auth, ...extra });
    this.code = r.code;
    return r;
  }
  connect(code = this.code) {
    this.code = code;
    return new Promise((resolve) => {
      this.ws = new WebSocket(BASE.replace('http', 'ws') + `/ws/${code}?g=${this.auth.guestId}&n=${encodeURIComponent(this.name)}`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onmessage = (e) => {
        this.onMsg(e.data);
        if (this.me && this.st) resolve(true);
        if (this.err) resolve(false);
      };
      this.ws.onerror = () => resolve(false);
      setTimeout(() => resolve(!!this.st), 5000);
    });
  }
  once(k, fn, ms) {
    if (this.done[k]) return;
    this.done[k] = true;
    setTimeout(fn, ms);
  }
  send(o) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(typeof o === 'string' || o instanceof Uint8Array ? o : JSON.stringify(o));
  }
  onMsg(data) {
    if (typeof data !== 'string') return;
    const m = JSON.parse(data);
    if (m.t === 'hello') this.me = m.you;
    if (m.t === 'error') this.err = m.code;
    if (m.t !== 'state') return;
    const st = (this.st = m.st);
    const g = st.gameNo;
    const r = st.round;
    if (st.phase === 'intro') this.once(`l${g}:${r}`, () => this.send({ t: 'loaded', r, dur: 1.2 }), 200);
    if (st.phase === 'perform')
      this.once(`p${g}:${r}`, () => {
        const enc = mulawEncode(tone(1.2, 220 + this.i * 90));
        const o = new Uint8Array(enc.length + 4);
        o[0] = 1;
        o[1] = r & 255;
        o.set(enc, 4);
        this.send(o);
      }, Math.max(0, st.t.recEnd - Date.now()) + 150);
    if (st.phase === 'analyze')
      this.once(`a${g}:${r}`, () => {
        const v = {};
        for (const uid of st.takes) v[uid] = 40;
        this.send({ t: 'scores', r, v });
      }, 200);
    if (st.phase === 'wheel' && st.wheel) {
      const w = st.wheel[this.me];
      if (w && w.seg == null) this.once(`s${g}:${r}`, () => this.send({ t: 'spin' }), 300);
      if (w && w.needTarget && !w.done) {
        const other = st.players.find((p) => p.uid !== this.me);
        if (other) this.once(`t${g}:${r}`, () => this.send({ t: 'target', uid: other.uid }), 500);
      }
    }
  }
  close() {
    try {
      this.send({ t: 'leave' });
      this.ws && this.ws.close();
    } catch {
      /* */
    }
  }
}
const until = async (fn, ms, step = 200) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await wait(step);
  }
  return false;
};

// 1) أول واحد يدور: غرفة جديدة. الثاني بنفس اللحظة (قبل ما الأول يدخل): نفس الغرفة
const A = new Bot('Ann');
const B = new Bot('Bob');
const rA = await A.quick();
const rB = await B.quick();
check(rA.fresh === true && /^\d{5}$/.test(rA.code), `أول واحد: غرفة عامة جديدة ${rA.code}`);
check(rB.code === rA.code && rB.fresh === false, `الثاني بنفس الوقت ينطى نفس الغرفة (${rB.code})`);
const C1 = rA.code;
await A.connect();
check(A.st && A.st.pub === true && A.st.autoAt === 0, `الغرفة عامة، وواحد بس = ينتظر بدون عد (autoAt=${A.st && A.st.autoAt})`);
await B.connect();
await wait(300);
const left1 = A.st.autoAt - Date.now();
check(A.st.players.length === 2 && left1 > T.MM_WAIT - 3000 && left1 <= T.MM_WAIT, `اثنين: يبدي عد ${Math.round(left1 / 1000)} ثانية`);

// 2) الثالث يدخل: ياخذ وقت يتهيأ
const Cc = new Bot('Cid');
const rC = await Cc.quick();
check(rC.code === C1, 'الثالث ينطى نفس الغرفة (الأملى أول)');
await Cc.connect();
await wait(300);
check(Cc.st.players.length === 3 && Cc.st.autoAt - Date.now() >= T.MM_JOIN - 1500, `ثلاثة بالغرفة والعد ما ينقص عن ${T.MM_JOIN / 1000} ثواني`);

// 3) تبدي لوحدها بدون ما أحد يضغط ابدأ
const started = await until(() => A.st && A.st.phase === 'intro', T.MM_WAIT + 6000);
check(started && A.st.gameNo === 1, `اللعبة بدت لوحدها (${A.st && A.st.phase})`);

// 4) اللي يدور هسه ما ينطى غرفة بنص لعبة
const D = new Bot('Dan');
const rD = await D.quick();
check(rD.code !== C1 && rD.fresh === true, `الغرفة اللي بدت ما تنعطى: غرفة جديدة ${rD.code}`);
const C2 = rD.code;
await D.connect();

// 5) غرفة تمتلي (5) → تبدي بسرعة، والسادس ينطى غيرها
const fill = [new Bot('Eve'), new Bot('Fay'), new Bot('Gus'), new Bot('Hal')];
const codes = [];
for (const b of fill) {
  codes.push((await b.quick()).code);
  await b.connect();
}
check(codes.every((c) => c === C2), `أربعة ثانيين ينجمعون ويا Dan بنفس الغرفة (${codes.join(',')})`);
await wait(300);
check(D.st.players.length === MAX_PLAYERS && D.st.autoAt - Date.now() <= T.MM_FULL + 200, `امتلت (${D.st.players.length}) → تبدي خلال ${Math.round((D.st.autoAt - Date.now()) / 1000)} ثانية`);
const I = new Bot('Ivy');
const rI = await I.quick();
check(rI.code !== C2 && rI.code !== C1, `السادس ينطى غرفة ثانية (${rI.code})`);
const startedFull = await until(() => D.st && D.st.phase === 'intro', T.MM_FULL + 3000);
check(startedFull, 'الغرفة المليانة بدت بسرعة');

// 6) غرفة طلعت مو موجودة: تنشال، والجاي ينطى غيرها
const rX = await new Bot('Xen').quick({ exclude: [rI.code], bad: rI.code });
check(rX.code !== rI.code, `الغرفة الغلط تنشال (${rI.code} → ${rX.code})`);
const stats = await fetch(BASE + '/api/quick/stats').then((r) => r.json());
check(typeof stats.rooms === 'number', `إحصائية الغرف العامة: ${JSON.stringify(stats)}`);

// 7) الغرفة الأولى تكمل لحد النهاية، وبعدها ترجع غرفة انتظار بنفس اللاعبين وتبدي عد جديد
for (const b of [D, ...fill]) b.close();
const ended = await until(() => A.st && A.st.phase === 'final', 200000, 500);
check(ended, `اللعبة خلصت (${A.st && A.st.phase})`);
const again = A.st.t && A.st.t.againAt ? A.st.t.againAt - Date.now() : -1;
check(again > T.MM_AGAIN - 4000 && again <= T.MM_AGAIN, `بالنهاية: اللعبة الجاية بعد ${Math.round(again / 1000)} ثانية`);
const back = await until(() => A.st && A.st.phase === 'lobby', T.MM_AGAIN + 5000);
check(back && A.st.pub && A.st.players.length === 3 && A.st.players.every((p) => p.score === 0) && A.st.autoAt > Date.now(), `رجعت غرفة انتظار بنفس الثلاثة والنقاط صفر وعد جديد (${A.st.players.length})`);
const J = new Bot('Joy');
const rJ = await J.quick();
check(rJ.code === C1, `واحد جديد يدور هسه ينطى نفس الغرفة (${rJ.code})`);
await J.connect();
await wait(300);
check(A.st.players.length === 4, 'دخل ويا الثلاثة');
const again2 = await until(() => A.st && A.st.phase === 'intro' && A.st.gameNo === 2, T.MM_WAIT + 8000);
check(again2, 'اللعبة الثانية بدت لوحدها');

for (const b of [A, B, Cc, J, I]) b.close();
console.log(`\n${ok} ✅  ${bad} ❌`);
process.exit(bad ? 1 : 0);
