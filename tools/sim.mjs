// محاكاة لعبة كاملة بعدة لاعبين وهميين عبر WebSocket (بدون واجهة).
// التشغيل: npx wrangler dev ثم:  node tools/sim.mjs [عدد_اللاعبين]
import { mulawEncode } from '../public/js/dsp.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const N = Number(process.argv[2] || 3);
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', body: JSON.stringify(body) });
  return r.json();
}

function tone(seconds, f) {
  const n = Math.floor(seconds * 16000);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * f * i) / 16000) * Math.min(1, i / 800, (n - i) / 800);
  return x;
}

class Bot {
  constructor(i, code) {
    this.i = i;
    this.gid = 'simbot' + i + Math.random().toString(36).slice(2, 8);
    this.name = 'بوت' + i;
    this.code = code;
    this.st = null;
    this.sentTake = 0;
    this.sentLoaded = 0;
    this.sentScores = 0;
    this.spun = 0;
    this.targeted = 0;
    this.takesIn = new Set();
    this.offset = 0;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const url = BASE.replace('http', 'ws') + `/ws/${this.code}?g=${this.gid}&n=${encodeURIComponent(this.name)}`;
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({ t: 'sync', c: Date.now() }));
        resolve();
      };
      this.ws.onerror = (e) => reject(e);
      this.ws.onclose = (e) => log(this.name, 'closed', e.code, e.reason);
      this.ws.onmessage = (e) => this.onMsg(e.data);
    });
  }
  now() {
    return Date.now() + this.offset;
  }
  onMsg(data) {
    if (typeof data !== 'string') {
      const u8 = new Uint8Array(data);
      this.takesIn.add(u8[2]);
      return;
    }
    const m = JSON.parse(data);
    if (m.t === 'hello') this.me = m.you;
    if (m.t === 'sync') this.offset = m.s - (m.c + Date.now()) / 2;
    if (m.t === 'error') log(this.name, 'ERROR', m.m);
    if (m.t !== 'state') return;
    const prev = this.st;
    const st = (this.st = m.st);
    if (!prev || prev.phase !== st.phase || prev.round !== st.round) {
      if (this.i === 0) log(`phase=${st.phase} round=${st.round}`, st.phase === 'playback' ? JSON.stringify(st.results) : '');
    }
    const me = this.me;
    if (st.phase === 'intro' && this.sentLoaded !== st.round) {
      this.sentLoaded = st.round;
      setTimeout(() => this.ws.send(JSON.stringify({ t: 'loaded', r: st.round, dur: 1.5 })), 300 + this.i * 200);
    }
    if (st.phase === 'perform' && this.sentTake !== st.round) {
      this.sentTake = st.round;
      const wait = Math.max(0, st.t.recEnd - this.now()) + 150;
      const round = st.round;
      setTimeout(() => {
        const enc = mulawEncode(tone(1.8, 300 + this.i * 100));
        const out = new Uint8Array(enc.length + 4);
        out[0] = 1;
        out[1] = round & 255;
        out.set(enc, 4);
        this.ws.send(out);
      }, wait);
    }
    if (st.phase === 'analyze' && this.sentScores !== st.round) {
      this.sentScores = st.round;
      const v = {};
      for (const uid of st.takes) v[uid] = 40 + this.i * 5 + (uid === me ? 50 : 0); // كل بوت يغش لنفسه
      setTimeout(() => this.ws.send(JSON.stringify({ t: 'scores', r: st.round, v })), 200);
    }
    if (st.phase === 'wheel' && st.wheel) {
      const w = st.wheel[me];
      if (w && w.seg == null && this.spun !== st.round) {
        this.spun = st.round;
        setTimeout(() => this.ws.send(JSON.stringify({ t: 'spin' })), 500 + this.i * 300);
      }
      if (w && w.needTarget && !w.done && this.targeted !== st.round) {
        this.targeted = st.round;
        const victim = st.players.find((p) => p.uid !== me);
        setTimeout(() => this.ws.send(JSON.stringify({ t: 'target', uid: victim.uid })), 4500);
      }
    }
  }
}

const { code } = await post('/api/rooms', { guestId: 'simhost123', guestName: 'host' });
log('room', code);
const bots = [];
for (let i = 0; i < N; i++) {
  const b = new Bot(i, code);
  await b.connect();
  bots.push(b);
}
await new Promise((r) => setTimeout(r, 800));
log('players', bots[0].st.players.map((p) => `${p.name}(skin ${p.skin})`).join(', '), 'host', bots[0].st.host === bots[0].me);
bots[0].ws.send(JSON.stringify({ t: 'start' }));

const t0 = Date.now();
await new Promise((resolve) => {
  const iv = setInterval(() => {
    const st = bots[0].st;
    if (st && st.phase === 'final') {
      clearInterval(iv);
      resolve();
    }
    if (Date.now() - t0 > 240000) {
      clearInterval(iv);
      log('TIMEOUT phase', st && st.phase);
      resolve();
    }
  }, 300);
});
const st = bots[0].st;
log('FINAL after', ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.table(st.finals.map((f) => ({ name: f.name, score: f.score, rank: f.rank })));
log('takes relayed to bot0 (seats):', [...bots[0].takesIn].join(','));
for (const b of bots) b.ws.close();
const top = await (await fetch(BASE + '/api/top')).json();
log('top (guests are not ranked):', top.top.length);
process.exit(0);
