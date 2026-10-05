// اختبار العجلة: النقاط تنضاف ويا درجة الجولة الجاية (مو وقت العجلة)، والتبديل يبادل التسجيلات والدرجات.
// يحتاج سيرفر بعجلة مثبّتة على قطعة:
//   npx wrangler dev --port 8791 --persist-to /tmp/wt --var WHEEL_FORCE:p10   ثم  BASE=http://127.0.0.1:8791 FORCE=p10 node tools/wheel-test.mjs
//   (ونفسه بـ WHEEL_FORCE:swap و FORCE=swap)
import { mulawEncode } from '../public/js/dsp.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const FORCE = process.env.FORCE || 'p10';
const N = 3;
let ok = 0;
let bad = 0;
const check = (cond, label) => {
  if (cond) ok++;
  else bad++;
  console.log(cond ? '✅' : '❌', label);
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

function tone(seconds, f) {
  const n = Math.floor(seconds * 16000);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * f * i) / 16000) * Math.min(1, i / 800, (n - i) / 800);
  return x;
}

// كل البوتات تنطي نفس الدرجة لكل تسجيل: 30 + 10 × مقعد صاحبه — حتى نعرف التسجيل من درجته
const rawOfSeat = (seat) => 30 + 10 * seat;

const history = []; // {round, phase, players:[{uid, score, mult, bonus}], results}

class Bot {
  constructor(i, code) {
    this.i = i;
    this.gid = 'wt' + i + Math.random().toString(36).slice(2, 8);
    this.name = 'بوت' + i;
    this.code = code;
    this.st = null;
    this.done = {};
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(BASE.replace('http', 'ws') + `/ws/${this.code}?g=${this.gid}&n=${encodeURIComponent(this.name)}`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => resolve();
      this.ws.onerror = reject;
      this.ws.onmessage = (e) => this.onMsg(e.data);
    });
  }
  once(key, fn, ms = 0) {
    if (this.done[key]) return;
    this.done[key] = true;
    setTimeout(fn, ms);
  }
  onMsg(data) {
    if (typeof data !== 'string') return;
    const m = JSON.parse(data);
    if (m.t === 'hello') this.me = m.you;
    if (m.t !== 'state') return;
    const prev = this.st;
    const st = (this.st = m.st);
    if (this.i === 0 && (!prev || prev.phase !== st.phase || prev.round !== st.round)) {
      history.push({ round: st.round, phase: st.phase, players: st.players.map((p) => ({ uid: p.uid, seat: p.seat, score: p.score, mult: p.mult, bonus: p.bonus })), results: st.results, play: st.play, swap: st.swap });
    }
    const r = st.round;
    if (st.phase === 'intro') this.once('l' + r, () => this.ws.send(JSON.stringify({ t: 'loaded', r, dur: 1.2 })), 200);
    if (st.phase === 'perform')
      this.once('p' + r, () => {
        const enc = mulawEncode(tone(1.2, 300 + this.i * 100));
        const out = new Uint8Array(enc.length + 4);
        out[0] = 1;
        out[1] = r & 255;
        out.set(enc, 4);
        this.ws.send(out);
      }, Math.max(0, st.t.recEnd - Date.now()) + 150);
    if (st.phase === 'analyze')
      this.once('a' + r, () => {
        const v = {};
        for (const uid of st.takes) v[uid] = rawOfSeat(st.players.find((p) => p.uid === uid).seat);
        this.ws.send(JSON.stringify({ t: 'scores', r, v }));
      }, 200);
    if (st.phase === 'wheel' && st.wheel) {
      const w = st.wheel[this.me];
      if (w && w.seg == null) this.once('s' + r, () => this.ws.send(JSON.stringify({ t: 'spin' })), 300);
      // بوت i يختار اللاعب اللي بعده
      if (w && w.needTarget && !w.done) {
        const order = st.players.map((p) => p.uid);
        const victim = order[(order.indexOf(this.me) + 1) % order.length];
        this.once('t' + r, () => this.ws.send(JSON.stringify({ t: 'target', uid: victim })), 600);
      }
    }
  }
}

const r0 = await fetch(BASE + '/api/rooms', { method: 'POST', body: JSON.stringify({ guestId: 'wthost' + Date.now(), guestName: 'host' }) });
const { code } = await r0.json();
log('room', code, 'force', FORCE);
const bots = [];
for (let i = 0; i < N; i++) {
  const b = new Bot(i, code);
  await b.connect();
  bots.push(b);
}
await new Promise((r) => setTimeout(r, 700));
bots[0].ws.send(JSON.stringify({ t: 'start' }));
const t0 = Date.now();
while (!(bots[0].st && bots[0].st.phase === 'final') && Date.now() - t0 < 240000) await new Promise((r) => setTimeout(r, 300));
check(bots[0].st && bots[0].st.phase === 'final', 'اللعبة خلصت');

const seatOf = Object.fromEntries(bots[0].st.players.map((p) => [p.uid, p.seat]));
const pb = history.filter((h) => h.phase === 'playback');
const wheels = history.filter((h) => h.phase === 'wheel');
const intros = history.filter((h) => h.phase === 'intro');
check(pb.length === 4, `4 جولات إعادة (${pb.length})`);

if (FORCE === 'p10') {
  // الجولة 1: بدون نقاط إضافية. من الجولة 2: كل لاعب +10 ويا درجته
  for (const h of pb) {
    for (const p of h.players) {
      const res = h.results[p.uid];
      const raw = rawOfSeat(p.seat);
      const want = h.round === 1 ? raw : raw + 10;
      check(res && res.raw === raw && res.gained === want && (res.bonus || 0) === (h.round === 1 ? 0 : 10), `جولة ${h.round} لاعب ${p.seat}: ${res && res.raw} → +${res && res.gained} (المتوقع +${want})`);
    }
  }
  // وقت العجلة والمقدمة: النقاط ما تتغير (تنضاف بس بالإعادة)
  for (const w of wheels) {
    const before = pb.find((h) => h.round === w.round);
    const nextIntro = intros.find((h) => h.round === w.round + 1);
    const same = nextIntro && before && nextIntro.players.every((p) => p.score === before.players.find((x) => x.uid === p.uid).score);
    check(same, `بعد عجلة الجولة ${w.round}: النقاط ما زادت قبل الجولة الجاية`);
    check(nextIntro && nextIntro.players.every((p) => p.bonus === 10), `الجولة ${w.round + 1} تبدي وكل لاعب عنده +10 معلّقة`);
  }
  const fin = bots[0].st.finals;
  const total = (seat) => 4 * rawOfSeat(seat) + 30;
  check(fin.every((f) => f.score === total(seatOf[f.uid])), 'المجموع النهائي = 4 درجات + 30 (ثلاث عجلات)');
}

if (FORCE === 'swap') {
  for (const h of pb) {
    if (h.round === 1) {
      check(h.players.every((p) => h.results[p.uid].src === p.uid), 'الجولة 1: كل واحد صوته');
      continue;
    }
    // كل بوت بدّل ويا اللي بعده بالترتيب: (0↔1) ثم (1↔2) ثم (2↔0)
    const order = h.players.map((p) => p.uid);
    const voice = Object.fromEntries(order.map((u) => [u, u]));
    for (const sw of h.swap || []) [voice[sw.a], voice[sw.b]] = [voice[sw.b], voice[sw.a]];
    check((h.swap || []).length === 3, `جولة ${h.round}: 3 تبديلات وصلت (${(h.swap || []).length})`);
    for (const p of h.players) {
      const res = h.results[p.uid];
      const src = voice[p.uid];
      const play = (h.play || []).find((x) => x.uid === p.uid);
      check(res.src === src && res.raw === rawOfSeat(seatOf[src]) && play && play.src === src, `جولة ${h.round}: لاعب ${p.seat} أخذ صوت لاعب ${seatOf[res.src]} ودرجته ${res.raw}`);
    }
    check(h.players.some((p) => h.results[p.uid].src !== p.uid), `جولة ${h.round}: صار تبديل فعلًا`);
  }
}

for (const b of bots) b.ws.close();
console.log(`\n${ok} نجح، ${bad} فشل`);
process.exit(bad ? 1 : 0);
