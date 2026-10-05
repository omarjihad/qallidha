// غرفة اللعب: كائن دائم لكل غرفة. يدير المراحل والتوقيت ونقل التسجيلات والعجلة.
// WebSocket بنمط السبات (Hibernation) حتى ما ينحسب وقت الانتظار على الخطة المجانية.

import { DurableObject } from 'cloudflare:workers';
import {
  ROUNDS,
  MAX_PLAYERS,
  MAX_REC,
  SKIN_COUNT,
  T,
  WHEEL,
  WHEEL_WEIGHTS,
  isTargeted,
  REACTIONS,
  TAKE_SR,
  performTimeline,
  playbackSeconds,
  median,
} from '../public/js/shared.js';
import { Tg } from './telegram.js';

const ERRORS = {
  started: 'اللعبة بدأت بهاي الغرفة — انتظر تخلص أو سوّي غرفة جديدة',
  full: `الغرفة مليانة (${MAX_PLAYERS} لاعبين)`,
  notfound: 'ماكو غرفة بهالكود 🤷 تأكد من الرقم',
};

const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;

function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.st = null;
    this.ensureTables();
    ctx.blockConcurrencyWhile(async () => {
      this.st = (await ctx.storage.get('st')) || null;
    });
    try {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    } catch {
      /* بيئات قديمة */
    }
    this.lastReact = new Map();
  }

  ensureTables() {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS takes (round INTEGER, uid TEXT, data BLOB, PRIMARY KEY (round, uid))');
  }

  fresh(code) {
    return {
      code: String(code || ''),
      created: Date.now(),
      host: null,
      phase: 'lobby',
      round: 0,
      rounds: ROUNDS,
      gameNo: 0,
      players: {},
      order: [],
      sounds: [],
      cur: null,
      t: {},
      loaded: {},
      takes: {},
      reports: {},
      results: {},
      play: [],
      wheel: {},
      sabNow: {},
      sabNext: {},
      swapNow: [],
      swapNext: [],
      finals: null,
      chatId: null,
      emptySince: 0,
    };
  }

  async save() {
    if (this.st) await this.ctx.storage.put('st', this.st);
  }

  hub() {
    const id = this.env.HUB.idFromName('hub');
    const hint = (this.env.DO_LOCATION_HINT || '').trim();
    return hint ? this.env.HUB.get(id, { locationHint: hint }) : this.env.HUB.get(id);
  }

  /* ============================================================ RPC من العامل */

  /** حجز الغرفة لرمز جديد. يرفض إذا فيها ناس متصلين. */
  async claim({ code, chatId = null } = {}) {
    const live = this.ctx.getWebSockets().length > 0;
    if (this.st && live) return false;
    this.ensureTables();
    this.ctx.storage.sql.exec('DELETE FROM takes');
    this.st = this.fresh(code);
    this.st.chatId = chatId;
    this.st.emptySince = Date.now();
    await this.save();
    await this.reschedule();
    return true;
  }

  async info() {
    if (!this.st) return { exists: false };
    return { exists: true, phase: this.st.phase, players: this.st.order.length, max: MAX_PLAYERS };
  }

  /* ============================================================ الاتصال */

  async fetch(request) {
    const url = new URL(request.url);
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    let user = null;
    try {
      user = JSON.parse(decodeURIComponent(request.headers.get('X-User') || 'null'));
    } catch {
      /* تجاهل */
    }
    if (!user || !user.uid) return new Response('unauthorized', { status: 401 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [user.uid]);
    server.serializeAttachment({ uid: user.uid, replaced: !this.st });

    // الغرفة لازم تكون منحجزة (من «العب ويا ربعك» أو /play) — الكود الغلط ما يسوّي غرفة
    const err = this.st ? this.join(user) : 'notfound';
    if (err) {
      server.send(JSON.stringify({ t: 'error', code: err, m: ERRORS[err] || err }));
      server.close(4001, err);
      return new Response(null, { status: 101, webSocket: client });
    }
    for (const ws of this.ctx.getWebSockets(user.uid)) {
      if (ws !== server) {
        try {
          ws.serializeAttachment({ uid: user.uid, replaced: true });
          ws.close(4000, 'replaced');
        } catch {
          /* مسكّر أصلًا */
        }
      }
    }
    this.st.emptySince = 0;
    if (!user.guest) await this.applyLook(user.uid);
    await this.save();
    server.send(JSON.stringify({ t: 'hello', you: user.uid, s: Date.now() }));
    this.broadcast();
    if (this.st.phase === 'analyze' || this.st.phase === 'playback') this.sendTakes(server);
    await this.reschedule();
    return new Response(null, { status: 101, webSocket: client });
  }

  join(user) {
    const st = this.st;
    let p = st.players[user.uid];
    if (p) {
      p.on = true;
      p.leftAt = 0;
      p.name = user.name || p.name;
      p.photo = user.photo || p.photo;
      if (!st.host || !st.players[st.host] || !st.players[st.host].on) st.host = user.uid;
      return null;
    }
    if (st.phase !== 'lobby' && st.phase !== 'final') return 'started';
    if (st.order.length >= MAX_PLAYERS) return 'full';
    const used = new Set(st.order.map((u) => st.players[u].skin));
    let skin = hash(user.uid) % SKIN_COUNT;
    for (let i = 0; i < SKIN_COUNT && used.has(skin); i++) skin = (skin + 1) % SKIN_COUNT;
    p = {
      uid: user.uid,
      name: user.name || 'لاعب',
      photo: user.photo || '',
      guest: !!user.guest,
      skin,
      score: 0,
      mult: 1,
      bonus: 0,
      on: true,
      mic: false,
      leftAt: 0,
    };
    st.players[user.uid] = p;
    st.order.push(user.uid);
    if (!st.host || !st.players[st.host] || !st.players[st.host].on) st.host = user.uid;
    return null;
  }

  /** شكل اللاعب من مخزونه بالـHub (شخصية + إكسسوارات + مسرح + لفل) */
  async applyLook(uid) {
    try {
      const lk = await this.hub().lookOf(uid);
      const p = this.st && this.st.players[uid];
      if (!p || !lk) return;
      if (lk.skin != null) p.skin = lk.skin;
      p.acc = { head: lk.head || null, face: lk.face || null };
      p.stage = lk.stage || 'stage:classic';
      p.lvl = lk.level || 1;
    } catch (e) {
      console.log('lookOf failed', e && e.message);
    }
  }

  connected(exclude = null) {
    const set = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude || ws.readyState !== 1) continue;
      const a = ws.deserializeAttachment();
      if (a && a.uid && !a.replaced) set.add(a.uid);
    }
    return this.st.order.filter((u) => set.has(u));
  }

  pickHost(exclude = null) {
    const on = this.connected(exclude);
    this.st.host = on[0] || this.st.order[0] || null;
  }

  async webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {
      /* مسكّر */
    }
    await this.onLeave(ws);
  }

  async webSocketError(ws) {
    await this.onLeave(ws);
  }

  async onLeave(ws) {
    const a = ws.deserializeAttachment() || {};
    if (!this.st || !a.uid || a.replaced) return;
    const still = this.ctx.getWebSockets(a.uid).some((w) => w !== ws && !(w.deserializeAttachment() || {}).replaced);
    if (still) return;
    const p = this.st.players[a.uid];
    if (!p) return;
    p.on = false;
    p.leftAt = Date.now();
    if (this.st.host === a.uid) this.pickHost(ws);
    if (this.connected(ws).length === 0) this.st.emptySince = Date.now();
    await this.save();
    this.broadcast();
    await this.advance();
  }

  /* ============================================================ الرسائل */

  async webSocketMessage(ws, msg) {
    const a = ws.deserializeAttachment() || {};
    const uid = a.uid;
    if (!this.st || !uid || a.replaced || !this.st.players[uid]) return;
    if (typeof msg !== 'string') return this.onTake(uid, msg);
    let m;
    try {
      m = JSON.parse(msg);
    } catch {
      return;
    }
    const st = this.st;
    const p = st.players[uid];
    switch (m.t) {
      case 'sync':
        ws.send(JSON.stringify({ t: 'sync', c: m.c, s: Date.now() }));
        return;
      case 'skin': {
        if (st.phase !== 'lobby' && st.phase !== 'final') return;
        const s = ((Number(m.skin) % SKIN_COUNT) + SKIN_COUNT) % SKIN_COUNT;
        const taken = st.order.some((u) => u !== uid && st.players[u].skin === s);
        if (taken) return;
        p.skin = s;
        break;
      }
      case 'mic':
        p.mic = !!m.ok;
        break;
      case 'look':
        // اللاعب غيّر لبسه بالمتجر: نقرأه من الـHub (ما نصدّق الواجهة)
        if (p.guest || (st.phase !== 'lobby' && st.phase !== 'final')) return;
        await this.applyLook(uid);
        break;
      case 'start':
        if (uid !== st.host || (st.phase !== 'lobby' && st.phase !== 'final')) return;
        await this.startGame();
        return;
      case 'loaded':
        if (st.phase !== 'intro' || m.r !== st.round) return;
        {
          const d = Number(m.dur);
          // -1 = حمّل بس ما عرف المدة (فشل التحميل): ما ينحسب بالوسيط
          st.loaded[uid] = d > 0 ? Math.max(0.3, Math.min(MAX_REC, d)) : -1;
        }
        await this.save();
        await this.advance(true);
        return;
      case 'scores': {
        if (st.phase !== 'analyze' || m.r !== st.round || typeof m.v !== 'object' || !m.v) return;
        const clean = {};
        for (const [k, v] of Object.entries(m.v)) {
          if (!st.takes[k]) continue;
          const n = Math.round(Number(v));
          if (Number.isFinite(n)) clean[k] = Math.max(0, Math.min(100, n));
        }
        st.reports[uid] = clean;
        await this.save();
        await this.advance(true);
        return;
      }
      case 'spin':
        if (st.phase !== 'wheel') return;
        this.spin(uid);
        await this.save();
        this.broadcast();
        await this.advance();
        return;
      case 'target':
        if (st.phase !== 'wheel') return;
        this.target(uid, String(m.uid || ''));
        await this.save();
        this.broadcast();
        await this.advance();
        return;
      case 'react': {
        const e = String(m.e || '');
        if (!REACTIONS.includes(e)) return;
        const last = this.lastReact.get(uid) || 0;
        if (Date.now() - last < 700) return;
        this.lastReact.set(uid, Date.now());
        const out = JSON.stringify({ t: 'react', uid, e });
        for (const w of this.ctx.getWebSockets()) {
          try {
            w.send(out);
          } catch {
            /* */
          }
        }
        return;
      }
      case 'leave': {
        if (st.phase === 'lobby' || st.phase === 'final') this.removePlayer(uid);
        else {
          p.on = false;
          p.leftAt = Date.now();
          if (st.host === uid) this.pickHost();
        }
        try {
          ws.serializeAttachment({ uid, replaced: true });
          ws.close(1000, 'left');
        } catch {
          /* */
        }
        if (this.connected().length === 0) st.emptySince = Date.now();
        await this.save();
        this.broadcast();
        await this.advance();
        return;
      }
      case 'kick': {
        if (uid !== st.host || st.phase !== 'lobby' || m.uid === uid) return;
        const target = String(m.uid || '');
        if (!st.players[target]) return;
        for (const w of this.ctx.getWebSockets(target)) {
          try {
            w.send(JSON.stringify({ t: 'error', code: 'kicked', m: 'المضيف طلّعك من الغرفة' }));
            w.serializeAttachment({ uid: target, replaced: true });
            w.close(4002, 'kicked');
          } catch {
            /* */
          }
        }
        this.removePlayer(target);
        break;
      }
      default:
        return;
    }
    await this.save();
    this.broadcast();
  }

  removePlayer(uid) {
    const st = this.st;
    delete st.players[uid];
    st.order = st.order.filter((u) => u !== uid);
    if (st.host === uid) this.pickHost();
  }

  /** تسجيل لاعب: [1, round, 0, 0] + μ-law */
  async onTake(uid, buf) {
    const st = this.st;
    const u8 = new Uint8Array(buf);
    if (u8.length < 8 || u8[0] !== 1) return;
    if (st.phase !== 'perform' && st.phase !== 'analyze') return;
    if (u8[1] !== (st.round & 255) || st.takes[uid]) return;
    if (u8.length > 4 + TAKE_SR * (MAX_REC + 1.5)) return;
    const data = u8.slice(4);
    this.ensureTables();
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO takes (round, uid, data) VALUES (?, ?, ?)', st.round, uid, data.buffer);
    st.takes[uid] = data.length;
    // نوصلها للباقين فورًا
    const seat = st.order.indexOf(uid);
    const out = new Uint8Array(data.length + 4);
    out[0] = 2;
    out[1] = st.round & 255;
    out[2] = seat;
    out.set(data, 4);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.uid === uid || a.replaced) continue;
      try {
        ws.send(out);
      } catch {
        /* */
      }
    }
    await this.save();
    this.broadcast();
    await this.advance(true);
  }

  sendTakes(ws) {
    const st = this.st;
    this.ensureTables();
    const rows = this.ctx.storage.sql.exec('SELECT uid, data FROM takes WHERE round = ?', st.round).toArray();
    for (const r of rows) {
      const data = new Uint8Array(r.data);
      const out = new Uint8Array(data.length + 4);
      out[0] = 2;
      out[1] = st.round & 255;
      out[2] = st.order.indexOf(r.uid);
      out.set(data, 4);
      try {
        ws.send(out);
      } catch {
        /* */
      }
    }
  }

  /* ============================================================ مراحل اللعبة */

  async startGame() {
    const st = this.st;
    const on = new Set(this.connected());
    for (const u of [...st.order]) if (!on.has(u)) this.removePlayer(u);
    if (!st.order.length) return;
    if (!st.host || !on.has(st.host)) st.host = st.order[0];
    for (const u of st.order) {
      st.players[u].score = 0;
      st.players[u].mult = 1;
      st.players[u].bonus = 0;
    }
    let sounds = [];
    try {
      sounds = await this.hub().pickSounds(ROUNDS);
    } catch (e) {
      console.log('pickSounds failed', e && e.message);
    }
    if (!sounds.length) {
      const out = JSON.stringify({ t: 'error', code: 'nosounds', m: 'ماكو ولا صوت شغّال 😕 الأدمن يفعّل أصوات من البوت بأمر /sounds' });
      for (const ws of this.ctx.getWebSockets(st.host)) {
        try {
          ws.send(out);
        } catch {
          /* */
        }
      }
      return;
    }
    st.sounds = sounds;
    st.rounds = Math.min(ROUNDS, sounds.length);
    st.gameNo += 1;
    st.round = 0;
    st.sabNext = {};
    st.swapNext = [];
    st.finals = null;
    this.ensureTables();
    this.ctx.storage.sql.exec('DELETE FROM takes');
    this.nextRound();
    await this.save();
    this.broadcast();
    await this.reschedule();
  }

  nextRound() {
    const st = this.st;
    // نقاط العجلة ما تنضاف هنا: تنحسب ويا درجة الجولة الجاية (beginPlayback)
    st.round += 1;
    st.cur = st.sounds[st.round - 1];
    st.loaded = {};
    st.takes = {};
    st.reports = {};
    st.results = {};
    st.play = [];
    st.wheel = {};
    st.sabNow = st.sabNext || {};
    st.sabNext = {};
    st.swapNow = st.swapNext || [];
    st.swapNext = [];
    this.ensureTables();
    this.ctx.storage.sql.exec('DELETE FROM takes WHERE round < ?', st.round);
    const now = Date.now();
    st.phase = 'intro';
    st.t = { phaseAt: now, introEnd: now + T.INTRO, loadDeadline: now + T.INTRO + T.LOAD_WAIT };
  }

  beginPerform() {
    const st = this.st;
    const durs = Object.values(st.loaded).filter((d) => d > 0);
    let dur = durs.length ? median(durs) : Number(st.cur && st.cur.dur) || 2.5;
    dur = Math.max(0.4, Math.min(MAX_REC, dur));
    const now = Date.now();
    const tl = performTimeline(now + T.LISTEN_LEAD, dur);
    st.phase = 'perform';
    st.t = { phaseAt: now, dur, ...tl };
  }

  beginAnalyze() {
    const st = this.st;
    const now = Date.now();
    st.phase = 'analyze';
    st.t = { ...st.t, phaseAt: now, analyzeEnd: now + T.ANALYZE_MAX };
  }

  /** التبديل: لمنو يرجع كل تسجيل. {uid: صاحب التسجيل اللي ينعاد باسمه} */
  voices() {
    const st = this.st;
    const voice = {};
    for (const u of st.order) voice[u] = u;
    for (const sw of st.swapNow || []) {
      if (!(sw.a in voice) || !(sw.b in voice) || sw.a === sw.b) continue;
      const x = voice[sw.a];
      voice[sw.a] = voice[sw.b];
      voice[sw.b] = x;
    }
    return voice;
  }

  beginPlayback() {
    const st = this.st;
    const now = Date.now();
    const voice = this.voices();
    st.results = {};
    for (const uid of st.order) {
      const p = st.players[uid];
      const src = voice[uid];
      // التخريب يلحق التسجيل نفسه (حتى لو انبدل)، والمضاعف والنقاط تلحق اللاعب
      const sab = (st.sabNow[src] || []).map((s) => s.type);
      const mult = p.mult || 1;
      const bonus = p.bonus || 0;
      p.mult = 1;
      p.bonus = 0;
      if (!st.takes[src]) {
        p.score += bonus;
        st.results[uid] = { raw: 0, gained: bonus, mult, bonus, none: true, sab, src };
        continue;
      }
      const votes = Object.values(st.reports)
        .map((r) => r[src])
        .filter((v) => Number.isFinite(v));
      const raw = votes.length ? Math.round(median(votes)) : 0;
      const gained = Math.round(raw * mult) + bonus;
      p.score += gained;
      st.results[uid] = { raw, gained, mult, bonus, sab, votes: votes.length, src };
    }
    let at = now + T.PLAY_LEAD;
    st.play = [];
    for (const uid of st.order) {
      const src = voice[uid];
      if (!st.takes[src]) {
        st.play.push({ uid, src, at, none: true, dur: 0 });
        at += T.NOTAKE;
        continue;
      }
      const sab = (st.sabNow[src] || []).map((s) => s.type);
      const dur = Math.round(playbackSeconds(st.takes[src], sab) * 1000);
      st.play.push({ uid, src, at, dur, walk: T.WALK });
      at += T.WALK + dur + T.REVEAL + T.BACK;
    }
    st.phase = 'playback';
    st.t = { ...st.t, phaseAt: now, playEnd: at + 400 };
  }

  beginWheel() {
    const st = this.st;
    const now = Date.now();
    st.phase = 'wheel';
    st.wheel = {};
    for (const uid of this.connected()) st.wheel[uid] = { seg: null, done: false, target: null, needTarget: false, spunAt: 0, doneAt: 0 };
    st.t = { phaseAt: now, autoSpin: now + T.WHEEL_AUTOSPIN, wheelEnd: now + T.WHEEL_MAX };
  }

  spin(uid) {
    const st = this.st;
    const w = st.wheel[uid];
    if (!w || w.seg != null) return;
    const solo = st.order.filter((u) => st.players[u].on).length < 2;
    const pool = WHEEL.map((s, i) => ({ i, s, w: WHEEL_WEIGHTS[s.id] || 1 })).filter((x) => !(solo && isTargeted(x.s)));
    const total = pool.reduce((a, x) => a + x.w, 0);
    let r = rnd() * total;
    let pick = pool[pool.length - 1];
    for (const x of pool) {
      r -= x.w;
      if (r <= 0) {
        pick = x;
        break;
      }
    }
    // للاختبار المحلي بس (ما ينحط بالنشر): WHEEL_FORCE=swap يخلي العجلة توكف على قطعة معيّنة
    const forced = String((this.env && this.env.WHEEL_FORCE) || '').trim();
    if (forced) pick = pool.find((x) => x.s.id === forced) || pick;
    const now = Date.now();
    w.seg = pick.i;
    w.spunAt = now;
    if (pick.s.kind === 'mult') st.players[uid].mult = pick.s.value;
    if (pick.s.kind === 'bonus') st.players[uid].bonus = (st.players[uid].bonus || 0) + pick.s.value;
    if (isTargeted(pick.s)) {
      w.needTarget = true;
      w.targetBy = now + T.SPIN_ANIM + T.TARGET_MAX;
    } else {
      w.done = true;
      w.doneAt = now + T.SPIN_ANIM;
    }
  }

  target(uid, targetUid) {
    const st = this.st;
    const w = st.wheel[uid];
    if (!w || !w.needTarget || w.done) return;
    if (!targetUid || targetUid === uid || !st.players[targetUid]) return;
    w.target = targetUid;
    w.done = true;
    w.doneAt = Date.now();
    const seg = WHEEL[w.seg];
    if (seg.kind === 'swap') (st.swapNext ||= []).push({ a: uid, b: targetUid });
    else (st.sabNext[targetUid] ||= []).push({ type: seg.sab, by: uid });
  }

  async finish() {
    const st = this.st;
    const now = Date.now();
    const ranking = st.order
      .map((u) => ({ uid: u, name: st.players[u].name, photo: st.players[u].photo, skin: st.players[u].skin, score: st.players[u].score, guest: st.players[u].guest }))
      .sort((a, b) => b.score - a.score);
    let rank = 0;
    let prev = null;
    ranking.forEach((r, i) => {
      if (r.score !== prev) rank = i + 1;
      prev = r.score;
      r.rank = rank;
    });
    st.finals = ranking;
    st.phase = 'final';
    st.t = { phaseAt: now };
    st.wheel = {};
    const winner = ranking[0] && ranking[0].score > 0 ? ranking[0].uid : null;
    {
      await (async () => {
        try {
          const rewards = (await this.hub().recordGame(ranking, winner, `${st.code}:${st.gameNo}:${now}`)) || {};
          for (const r of ranking) {
            r.reward = rewards[r.uid] || null;
            const p = st.players[r.uid];
            if (p && r.reward) p.lvl = r.reward.lvTo;
          }
        } catch (e) {
          console.log('recordGame failed', e && e.message);
        }
        if (st.chatId && this.env.TELEGRAM_BOT_TOKEN) {
          const medal = ['🥇', '🥈', '🥉'];
          const text = [
            '‏🎤 خلصت جولة «قلّدها»!',
            '',
            ...ranking.map((r) => `‏${medal[r.rank - 1] || r.rank + '.'} ${r.name} — ${r.score} نقطة`),
          ].join('\n');
          await new Tg(this.env.TELEGRAM_BOT_TOKEN, this.env.TG_API_BASE).call('sendMessage', { chat_id: st.chatId, text }).catch(() => null);
        }
      })();
    }
  }

  /** خطوة واحدة بالآلة: ترجع true إذا تغيّرت المرحلة. */
  async step() {
    const st = this.st;
    const now = Date.now();
    const on = this.connected();
    switch (st.phase) {
      case 'intro': {
        const all = on.length > 0 && on.every((u) => st.loaded[u]);
        if (now >= st.t.introEnd && (all || now >= st.t.loadDeadline)) {
          this.beginPerform();
          return true;
        }
        return false;
      }
      case 'perform': {
        const all = on.every((u) => st.takes[u]);
        if ((all && now >= st.t.recEnd) || now >= st.t.recEnd + T.UPLOAD_GRACE) {
          this.beginAnalyze();
          return true;
        }
        return false;
      }
      case 'analyze': {
        const need = on.length ? on : [];
        const all = need.length > 0 && need.every((u) => st.reports[u]);
        if (all || now >= st.t.analyzeEnd || Object.keys(st.takes).length === 0) {
          this.beginPlayback();
          return true;
        }
        return false;
      }
      case 'playback': {
        if (now >= st.t.playEnd) {
          if (st.round < st.rounds) this.beginWheel();
          else await this.finish();
          return true;
        }
        return false;
      }
      case 'wheel': {
        let changed = false;
        if (now >= st.t.autoSpin) {
          for (const uid of Object.keys(st.wheel)) {
            if (st.wheel[uid].seg == null) {
              this.spin(uid);
              changed = true;
            }
          }
        }
        for (const [uid, w] of Object.entries(st.wheel)) {
          if (w.needTarget && !w.done && now >= w.targetBy) {
            const options = st.order.filter((u) => u !== uid);
            if (options.length) this.target(uid, options[Math.floor(rnd() * options.length)]);
            else {
              w.done = true;
              w.doneAt = now;
            }
            changed = true;
          }
        }
        const ws = Object.values(st.wheel);
        const lastDone = ws.reduce((m, w) => Math.max(m, w.doneAt || 0), 0);
        const allDone = ws.every((w) => w.done);
        if ((allDone && now >= lastDone + T.RESULT_HOLD) || now >= st.t.wheelEnd || ws.length === 0) {
          for (const [uid, w] of Object.entries(st.wheel)) {
            if (w.needTarget && !w.done) {
              const options = st.order.filter((u) => u !== uid);
              if (options.length) this.target(uid, options[Math.floor(rnd() * options.length)]);
            }
          }
          this.nextRound();
          return true;
        }
        if (changed) {
          await this.save();
          this.broadcast();
        }
        return false;
      }
      default:
        return false;
    }
  }

  /** ينظف غرفة الانتظار من المنقطعين. */
  cleanupLobby() {
    const st = this.st;
    if (st.phase !== 'lobby' && st.phase !== 'final') return false;
    const now = Date.now();
    let changed = false;
    for (const u of [...st.order]) {
      const p = st.players[u];
      if (!p.on && p.leftAt && now - p.leftAt >= T.LOBBY_DROP) {
        this.removePlayer(u);
        changed = true;
      }
    }
    return changed;
  }

  async advance(forceBroadcast = false) {
    if (!this.st) return;
    let changed = false;
    for (let i = 0; i < 6; i++) {
      const moved = await this.step();
      if (!moved) break;
      changed = true;
    }
    if (this.cleanupLobby()) changed = true;
    if (changed || forceBroadcast) {
      await this.save();
      this.broadcast();
    }
    await this.reschedule();
  }

  async alarm() {
    if (!this.st) return;
    const now = Date.now();
    if (this.connected().length === 0 && this.st.emptySince && now - this.st.emptySince >= T.ROOM_TTL) {
      await this.ctx.storage.deleteAll();
      this.st = null;
      return;
    }
    await this.advance();
  }

  async reschedule() {
    const st = this.st;
    if (!st) return;
    const now = Date.now();
    const times = [];
    const t = st.t || {};
    switch (st.phase) {
      case 'intro':
        times.push(t.introEnd, t.loadDeadline);
        break;
      case 'perform':
        times.push(t.recEnd, t.recEnd + T.UPLOAD_GRACE);
        break;
      case 'analyze':
        times.push(t.analyzeEnd);
        break;
      case 'playback':
        times.push(t.playEnd);
        break;
      case 'wheel': {
        times.push(t.autoSpin, t.wheelEnd);
        for (const w of Object.values(st.wheel)) {
          if (w.needTarget && !w.done) times.push(w.targetBy);
          if (w.doneAt) times.push(w.doneAt + T.RESULT_HOLD);
        }
        break;
      }
      default:
        for (const u of st.order) {
          const p = st.players[u];
          if (!p.on && p.leftAt) times.push(p.leftAt + T.LOBBY_DROP);
        }
    }
    if (this.connected().length === 0 && st.emptySince) times.push(st.emptySince + T.ROOM_TTL);
    const future = times.filter((x) => Number.isFinite(x) && x > now - 5);
    if (!future.length) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const next = Math.max(now + 20, Math.min(...future));
    await this.ctx.storage.setAlarm(next);
  }

  /* ============================================================ البث */

  view(forUid) {
    const st = this.st;
    const inGame = st.phase !== 'lobby' && st.phase !== 'final';
    const showSab = st.phase === 'analyze' || st.phase === 'playback';
    let wheel = null;
    if (st.phase === 'wheel') {
      wheel = {};
      for (const [uid, w] of Object.entries(st.wheel)) {
        if (uid === forUid) wheel[uid] = w;
        else {
          const seg = w.seg != null ? WHEEL[w.seg] : null;
          // التخريب والتبديل مفاجأة: الباقين يشوفون 😈 بس
          wheel[uid] = { spun: w.seg != null, done: w.done, kind: seg ? (isTargeted(seg) ? 'sab' : seg.kind) : null, seg: seg && !isTargeted(seg) ? w.seg : null, spunAt: w.spunAt };
        }
      }
    }
    return {
      code: st.code,
      phase: st.phase,
      round: st.round,
      rounds: st.rounds,
      host: st.host,
      gameNo: st.gameNo,
      players: st.order.map((u, seat) => {
        const p = st.players[u];
        return { uid: u, seat, name: p.name, photo: p.photo, skin: p.skin, acc: p.acc || null, lvl: p.lvl || 0, score: p.score, mult: p.mult, bonus: p.bonus || 0, on: p.on, mic: p.mic, guest: p.guest };
      }),
      stage: (st.host && st.players[st.host] && st.players[st.host].stage) || 'stage:classic',
      sound: inGame && st.cur ? st.cur : null,
      preload: inGame ? st.sounds.slice(Math.max(0, st.round - 1)).map((s) => ({ url: s.url, video: !!s.video })) : [],
      t: st.t,
      loaded: Object.keys(st.loaded),
      takes: Object.keys(st.takes),
      reports: Object.keys(st.reports),
      sab: showSab ? st.sabNow : null,
      swap: showSab ? st.swapNow || [] : null,
      results: st.phase === 'playback' || st.phase === 'wheel' ? st.results : null,
      play: st.phase === 'playback' ? st.play : null,
      wheel,
      // كل لاعب يشوف مكافأته بس
      finals: st.phase === 'final' ? (st.finals || []).map((r) => (r.uid === forUid ? r : { ...r, reward: undefined })) : null,
      chat: !!st.chatId,
    };
  }

  broadcast() {
    if (!this.st) return;
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (!a.uid || a.replaced) continue;
      try {
        ws.send(JSON.stringify({ t: 'state', now, st: this.view(a.uid) }));
      } catch {
        /* */
      }
    }
  }
}

