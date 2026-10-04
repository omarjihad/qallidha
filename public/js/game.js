// متحكّم اللعبة: يحوّل حالة السيرفر إلى صوت وحركة وواجهة، بتوقيت متزامن عند الكل.
// اللقطات مثل الأصلية: لقطة واسعة للمسرح، شاشة المثال، «حاول تقلّدها»، ولقطة قريبة لشخصيتك وقت التسجيل.

import { T, WHEEL, SAB_INFO, REACTIONS, ROUNDS } from './shared.js';
import { SR, mulawEncode, mulawDecode, hashString, peakOf } from './dsp.js';
import { analyze, compare } from './scorer.js';
import { applySabotage } from './effects.js';
import { RoomConnection } from './net.js';
import { AudioEngine } from './audio.js';
import { Wheel } from './wheel.js';
import * as ui from './ui.js';
import { $, el } from './ui.js';
import { haptic, closingConfirmation, backButton, shareText } from './tg.js';

// مهلة قبل بداية موجة المثال داخل نافذة التسجيل (ثواني) — الناس تبدي متأخرة شوية بعد «يلا!»
const LEAD = 0.25;

const SPEAKER_SVG =
  '<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#34d12c" stroke="#0f5a0c" stroke-width="1.1" d="M3 9h4l5-4v14l-5-4H3z"/><path fill="none" stroke="#34d12c" stroke-width="2.4" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

export class Game {
  constructor({ stage, audio, config, onExit }) {
    this.stage = stage;
    /** @type {AudioEngine} */
    this.audio = audio;
    this.config = config || {};
    this.onExit = onExit;
    this.conn = null;
    this.st = null;
    this.me = null;
    this.timers = [];
    this.takes = new Map(); // `${round}:${uid}` → Uint8Array
    this.processed = new Map(); // `${gameNo}:${round}:${uid}` → Float32Array بعد التخريب
    this.scored = new Set();
    this.sentLoaded = new Set();
    this.sentTake = new Set();
    this.revealed = new Set();
    this.labels = new Map();
    this.talkers = new Map();
    this.wavebar = new ui.WaveBar($('#wavebar'));
    this.wheel = null;
    this.wheelSpunFor = null;
    this.targeting = false;
    this.phaseKey = '';
    this.refEntry = null;
    this.frameFn = (dt) => this.onFrame(dt);
    stage.onFrame(this.frameFn);
    this.active = false;
  }

  /* ================================================== دخول وخروج */

  enter(code) {
    this.active = true;
    this.code = code;
    document.documentElement.dataset.screen = 'room';
    ui.closeOverlay();
    this.stage.setShot('wide');
    this.renderLobbyBar({ connecting: true });
    this.conn = new RoomConnection(code, {
      hello: (m) => {
        this.me = m.you;
      },
      state: (m) => this.apply(m.st),
      take: (t) => this.onTake(t),
      react: (m) => this.showReaction(m.uid, m.e),
      error: (m) => {
        ui.toast(m.m || 'صار خطأ', 3500);
        if (['started', 'full', 'kicked', 'notfound'].includes(m.code)) setTimeout(() => this.leave(true), 600);
      },
      status: (s) => this.onStatus(s),
    });
    backButton(() => this.askLeave());
  }

  async askLeave() {
    const inGame = this.st && this.st.phase !== 'lobby' && this.st.phase !== 'final';
    const ok = !inGame || (await ui.confirmDialog('تطلع من اللعبة؟ نقاطك تبقى بس ما راح تكمّل الجولات.', 'إي اطلع', 'لا'));
    if (ok) this.leave();
  }

  leave(silent = false) {
    this.active = false;
    this.clearTimers();
    if (this.conn) this.conn.close();
    this.conn = null;
    this.st = null;
    this.audio.disarm();
    if (this.audio.releaseAfterRecord) this.audio.closeMic();
    closingConfirmation(false);
    backButton(null);
    this.stage.setPlayers([]);
    this.stage.offFrame(this.frameFn);
    for (const l of this.labels.values()) {
      l.el.remove();
      l.hit.remove();
      l.fx.remove();
    }
    this.labels.clear();
    $('#netState').className = '';
    const tap = $('#tapAudio');
    if (tap) tap.remove();
    $('#cards').innerHTML = '';
    $('#lobbyBar').innerHTML = '';
    $('#hudInfo').innerHTML = '';
    $('#reacts').classList.remove('show', 'open');
    delete document.documentElement.dataset.phase;
    delete document.documentElement.dataset.targeting;
    this.setDim(null);
    this.wavebar.show(false);
    this.setCount('');
    this.hideWheel();
    ui.clearCenter();
    ui.hideMeme();
    ui.closeOverlay();
    if (this.onExit) this.onExit(silent);
  }

  onStatus(s) {
    const ind = $('#netState');
    if (s === 'open') ind.className = '';
    else if (s === 'reconnecting' || s === 'connecting') {
      ind.className = 'show';
      ind.textContent = s === 'connecting' ? 'جاري الاتصال…' : 'جاري إعادة الاتصال…';
    } else if (s === 'lost') {
      ind.className = 'show bad';
      ind.textContent = 'انقطع الاتصال 😕';
      setTimeout(() => this.active && this.leave(), 2500);
    }
  }

  /* ================================================== أدوات */

  serverNow() {
    return this.conn ? this.conn.serverNow() : Date.now();
  }

  at(serverTs, fn) {
    const h = setTimeout(fn, Math.max(0, serverTs - this.serverNow()));
    this.timers.push(h);
    return h;
  }

  clearTimers() {
    for (const h of this.timers) clearTimeout(h);
    this.timers = [];
  }

  ctxTime(serverTs) {
    return this.audio.now() + (serverTs - this.serverNow()) / 1000;
  }

  player(uid) {
    return this.st && this.st.players.find((p) => p.uid === uid);
  }

  /** ستارة عنابية فوق المسرح: full = تغطي كلشي (شاشة المثال)، null = تختفي */
  setDim(mode) {
    $('#dim').className = mode ? 'show ' + mode : '';
  }

  /** رقم العد فوق شريط الموجة (مثل الأصلية) */
  setCount(text) {
    const b = $('#countBadge');
    b.textContent = text;
    b.classList.remove('pop');
    if (text) {
      void b.offsetWidth;
      b.classList.add('pop');
    }
  }

  /* ================================================== تطبيق الحالة */

  apply(st) {
    const prev = this.st;
    this.st = st;
    if (!this.me) return;
    this.stage.setPlayers(st.players.map((p) => ({ uid: p.uid, skin: p.skin })));
    this.syncLabels();
    const key = `${st.gameNo}:${st.round}:${st.phase}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.enterPhase(st, prev);
    } else this.updatePhase(st);
    this.renderCardsNow();
  }

  renderCardsNow() {
    const st = this.st;
    if (!st) return;
    const gains = {};
    const badges = {};
    const players = st.players.map((p) => {
      let score = p.score;
      if (st.phase === 'playback' && st.results && st.results[p.uid] && !this.revealed.has(p.uid)) score -= st.results[p.uid].gained || 0;
      if (st.phase === 'playback' && this.revealed.has(p.uid) && st.results && st.results[p.uid]) gains[p.uid] = st.results[p.uid].gained;
      if (st.phase === 'wheel' && st.wheel && st.wheel[p.uid]) {
        const w = st.wheel[p.uid];
        const mine = p.uid === this.me;
        const seg = w.seg != null ? WHEEL[w.seg] : null;
        const shown = mine ? this.wheelLanded : true;
        if (seg && shown) badges[p.uid] = seg.kind === 'sab' ? (mine ? seg.icon : '😈') : seg.label;
        else if (!mine && w.kind === 'sab') badges[p.uid] = '😈';
      }
      return { ...p, score };
    });
    ui.renderCards(players, { me: this.me, host: st.host, gains, badges });
  }

  enterPhase(st) {
    this.clearTimers();
    ui.clearCenter();
    this.setCount('');
    $('#goText').classList.remove('show');
    document.documentElement.dataset.phase = st.phase;
    this.targeting = false;
    this.setTargeting(false);
    this.setFocusLabel(null);
    const inGame = st.phase !== 'lobby' && st.phase !== 'final';
    closingConfirmation(inGame);
    $('#reacts').classList.toggle('show', st.phase !== 'lobby');
    if (st.phase !== 'wheel') this.hideWheel();
    if (st.phase !== 'perform') {
      ui.hideMeme();
      this.wavebar.show(false);
      this.audio.disarm();
      this.setDim(null);
      $('#caption').textContent = '';
    }
    if (st.phase !== 'final') ui.closeOverlay();
    for (const [uid, c] of this.stage.chars) {
      c.talkTarget = 0;
      if (st.phase !== 'playback' && c.atMic) this.stage.unfocus(uid);
    }
    this.setSpeakers([]);
    if (st.phase !== 'lobby') $('#lobbyBar').innerHTML = '';
    if (st.phase !== 'perform') this.stage.setShot('wide');
    $('#hudInfo').innerHTML = '';

    switch (st.phase) {
      case 'lobby':
        this.renderLobbyBar();
        break;
      case 'intro':
        this.revealed.clear();
        this.wheelSpunFor = null;
        this.wheelLanded = false;
        this.preload(st);
        ui.banner(`الجولة ${st.round} من ${st.rounds}`, 'bubble round', 2200);
        this.audio.sfx('whoosh');
        break;
      case 'perform':
        this.runPerform(st);
        break;
      case 'analyze':
        ui.banner('جاري التحليل…', 'small sticky', 0);
        this.maybeScore();
        break;
      case 'playback':
        this.runPlayback(st);
        break;
      case 'wheel':
        this.runWheel(st);
        break;
      case 'final':
        $('#hudInfo').appendChild(el('div', { class: 'pill dim' }, `الغرفة ${st.code}`));
        this.runFinal(st);
        break;
      default:
    }
  }

  updatePhase(st) {
    if (st.phase === 'lobby') this.renderLobbyBar();
    if (st.phase === 'intro') this.preload(st);
    if (st.phase === 'analyze') this.maybeScore();
    if (st.phase === 'wheel') this.updateWheel(st);
  }

  /* ================================================== غرفة الانتظار */

  renderLobbyBar({ connecting = false } = {}) {
    const bar = $('#lobbyBar');
    if (connecting || !this.st) {
      bar.innerHTML = '';
      this.lobbySig = '';
      bar.appendChild(el('div', { class: 'lobby-wait' }, 'جاري الدخول للغرفة…'));
      return;
    }
    const st = this.st;
    const isHost = st.host === this.me;
    const mic = this.audio.micState;
    const micOk = mic === 'on' || (this.player(this.me) || {}).mic;
    const n = st.players.length;
    const sig = [isHost, micOk, mic, n, st.code].join('|');
    if (sig === this.lobbySig && bar.firstChild) return;
    this.lobbySig = sig;
    bar.innerHTML = '';
    bar.appendChild(
      el(
        'div',
        { class: 'lobby-row' },
        el('div', { class: 'room-code' }, el('small', {}, 'كود الغرفة'), el('b', {}, st.code)),
        el('button', { class: 'btn blue', onclick: () => this.invite() }, '📨 ادعُ ربعك'),
        el('button', { class: 'btn purple', onclick: () => this.nextSkin() }, '🎭 غيّر شكلك'),
        el(
          'button',
          { class: 'btn ' + (micOk ? 'green' : 'orange pulse'), onclick: () => this.enableMic() },
          micOk ? '🎤 المايك جاهز' : mic === 'denied' ? '🚫 المايك مرفوض' : '🎤 فعّل المايك',
        ),
        isHost
          ? el('button', { class: 'btn pink big', onclick: () => this.start() }, n < 2 ? '▶️ ابدأ (وحدك)' : '▶️ ابدأ اللعبة')
          : el('div', { class: 'lobby-wait' }, '⏳ بانتظار المضيف يبدي…'),
      ),
    );
    const center = $('#center');
    const txt = n < 2 ? 'ادعُ ربعك — لحد 5 لاعبين 🎤' : `${n} لاعبين بالغرفة`;
    const hint = center.querySelector('.lobby-hint');
    if (hint) hint.textContent = txt;
    else {
      ui.clearCenter();
      center.appendChild(el('div', { class: 'lobby-hint' }, txt));
    }
  }

  inviteLink() {
    const c = this.config;
    if (c.bot) return `https://t.me/${c.bot}${c.appShort ? '/' + c.appShort : ''}?startapp=r${this.st.code}`;
    return `${location.origin}/?room=${this.st.code}`;
  }

  invite() {
    haptic('light');
    shareText(this.inviteLink(), `🎤 تعال العب وياي «قلّدها» — لعبة تقليد الأصوات!\nكود الغرفة: ${this.st.code}`);
  }

  nextSkin() {
    const st = this.st;
    const mine = this.player(this.me);
    if (!mine) return;
    const taken = new Set(st.players.filter((p) => p.uid !== this.me).map((p) => p.skin));
    let s = mine.skin;
    for (let i = 0; i < 8; i++) {
      s = (s + 1) % 8;
      if (!taken.has(s)) break;
    }
    haptic('select');
    this.audio.sfx('pop');
    this.conn.send({ t: 'skin', skin: s });
  }

  async enableMic() {
    await this.audio.unlock();
    const ok = await this.audio.openMic();
    if (ok) {
      haptic('success');
      ui.toast('🎤 المايك اشتغل');
      this.conn.send({ t: 'mic', ok: true });
      if (this.audio.releaseAfterRecord) this.audio.closeMic();
    } else {
      haptic('error');
      ui.toast(this.audio.micState === 'denied' ? 'المايك مرفوض — اسمح لتيليجرام يستخدم المايك من إعدادات الجهاز' : 'ما كدرنا نشغّل المايك', 4000);
      this.conn.send({ t: 'mic', ok: false });
    }
    this.renderLobbyBar();
  }

  async start() {
    await this.audio.unlock();
    if (this.audio.micState !== 'on' && !(this.player(this.me) || {}).mic) {
      const ok = await this.audio.openMic();
      if (ok) {
        this.conn.send({ t: 'mic', ok: true });
        if (this.audio.releaseAfterRecord) this.audio.closeMic();
      }
    }
    haptic('medium');
    this.conn.send({ t: 'start' });
  }

  /* ================================================== التحميل */

  preload(st) {
    const list = st.preload || [];
    list.forEach((s, i) => {
      const p = this.audio.load(s.url, { video: s.video });
      if (i === 0 && st.phase === 'intro' && !this.sentLoaded.has(`${st.gameNo}:${st.round}`)) {
        this.sentLoaded.add(`${st.gameNo}:${st.round}`);
        p.then(
          (entry) => {
            if (!entry.feat) entry.feat = analyze(entry.pcm);
            this.conn && this.conn.send({ t: 'loaded', r: st.round, dur: entry.dur });
          },
          () => {
            ui.toast('ما كدرنا نحمّل الصوت 😕');
            this.conn && this.conn.send({ t: 'loaded', r: st.round, dur: -1 });
          },
        );
      }
    });
  }

  /* ================================================== الأداء: اسمع ← حاول تقلّدها ← عد ← سجّل */

  async runPerform(st) {
    const t = st.t;
    const sound = st.sound || {};
    const round = st.round;
    const late0 = this.serverNow() > t.countAt;

    // 1) ستارة عنابية + «حاول.. تقلّدها!» تطير حروفها (مثل الأصلية) والمثال يشتغل وياها
    if (!late0) {
      this.setDim('full');
      ui.reproduceBanner(Math.max(500, t.countAt - this.serverNow() - 60));
      this.audio.sfx('whoosh');
    }
    let entry = null;
    try {
      entry = await this.audio.load(sound.url, { video: sound.video });
      if (!entry.feat) entry.feat = analyze(entry.pcm);
    } catch {
      entry = null;
    }
    if (!this.active || !this.st || this.st.round !== round || this.st.phase !== 'perform') return;
    this.refEntry = entry;
    const now = this.serverNow();
    const late = now > t.recAt + 300;
    const dur = Math.max(0.2, (t.listenEnd - t.listenAt) / 1000);
    const win = t.recDur / 1000;

    this.wavebar.setRef(entry ? entry.peaks : null, dur, win, LEAD);
    this.wavebar.mode = 'listen';
    this.wavebar.show(true);
    $('#caption').textContent = sound.title ? `${sound.emoji ? sound.emoji + ' ' : ''}${sound.title}` : '';
    const media = now < t.countAt ? ui.showMeme(sound, entry) : null;
    if (entry && now < t.listenEnd) {
      if (!this.audio.running) this.tapToHear(entry, t);
      this.audio.play(entry.buffer, this.ctxTime(t.listenAt));
      if (media && media.tagName === 'VIDEO') {
        this.at(t.listenAt, () => {
          try {
            media.currentTime = entry.offset || 0;
            media.play().catch(() => null);
          } catch {
            /* */
          }
        });
      }
    }
    this.progressAnim = { from: t.listenAt, to: t.listenEnd, t0: LEAD, t1: LEAD + dur, fill: false };

    // المايك ينفتح بعد ما يخلص المثال (حتى ما يلقط الصوت من السماعة)
    this.at(t.reproduceAt, () => {
      if (this.audio.micState !== 'on')
        this.audio.openMic().then((ok) => {
          if (!ok) return;
          this.conn && this.conn.send({ t: 'mic', ok: true });
          if (this.serverNow() >= t.countAt) this.armIfNeeded();
        });
    });

    // 2) العد: الستارة تنشال والكاميرا تقرب على شخصيتك، والأرقام على الشريط
    this.at(t.countAt, () => {
      ui.clearCenter();
      ui.hideMeme();
      this.setDim(null);
      this.stage.setShot('closeup', this.me);
      this.progressAnim = null;
      this.wavebar.mode = 'count';
      this.wavebar.time = 0;
      this.wavebar.fillTo = -1;
      $('#caption').textContent = 'الكل سوا — فرصة وحدة بس!';
    });
    for (let k = 0; k < 3; k++) {
      this.at(t.countAt + k * T.COUNT_STEP, () => {
        this.setCount(String(3 - k));
        this.audio.sfx('tick');
        haptic('light');
      });
    }
    this.at(t.countAt + T.COUNT_STEP, () => this.armIfNeeded());

    // 3) يلا! — التسجيل: المؤشر يمشي والموجة تتلوّن زرقاء
    this.at(t.recAt, () => {
      this.armIfNeeded();
      this.setCount('');
      $('#caption').textContent = '';
      $('#goText').classList.add('show');
      this.audio.sfx('go');
      haptic('medium');
      this.wavebar.mode = 'record';
      this.progressAnim = { from: t.recAt, to: t.recEnd, t0: 0, t1: win, fill: true };
      const mine = this.stage.char(this.me);
      for (const [uid, c] of this.stage.chars) if (uid !== this.me) c.setMood('sing', t.recDur);
      this.audio.onChunk = (time, d) => {
        let p = 0;
        for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
        if (mine) mine.talkTarget = Math.min(1, p * 3);
      };
    });

    // 4) انتهى ← إرسال
    this.at(t.recEnd + 120, () => this.finishTake(st, late));
  }

  /** الصوت مقفول (ما صارت لمسة بعد): زر كبير يفتحه ويشغّل المثال من مكانه. */
  tapToHear(entry, t) {
    if ($('#tapAudio')) return;
    const b = el(
      'button',
      {
        id: 'tapAudio',
        class: 'btn pink big',
        onclick: async () => {
          await this.audio.unlock();
          b.remove();
          if (this.serverNow() < t.listenEnd) this.audio.play(entry.buffer, this.ctxTime(t.listenAt));
        },
      },
      '🔊 اضغط حتى تسمع',
    );
    $('#app').appendChild(b);
    setTimeout(() => b.remove(), Math.max(1500, t.listenEnd - this.serverNow() + 500));
  }

  armIfNeeded() {
    if (this.audio.micState === 'on' && !this.audio.armed) this.audio.arm();
  }

  finishTake(st, late) {
    const round = st.round;
    const key = `${st.gameNo}:${round}`;
    if (this.sentTake.has(key)) return;
    this.sentTake.add(key);
    const hadMic = this.audio.micState === 'on';
    this.audio.onChunk = null;
    const mine = this.stage.char(this.me);
    if (mine) mine.talkTarget = 0;
    this.progressAnim = null;
    let pcm;
    if (!late && hadMic && this.audio.chunks.length) {
      pcm = this.audio.extract(this.ctxTime(st.t.recAt), this.ctxTime(st.t.recEnd));
    } else pcm = new Float32Array(Math.floor(0.3 * SR));
    this.audio.disarm();
    if (this.audio.releaseAfterRecord) this.audio.closeMic();
    // نكبّر الصوت الواطي قبل الإرسال حتى ينسمع زين بالإعادة (والصمت يبقى صمت)
    const pk = peakOf(pcm);
    if (pk >= 0.006) {
      const g = Math.min(20, 0.9 / pk);
      for (let i = 0; i < pcm.length; i++) pcm[i] *= g;
    }
    const enc = mulawEncode(pcm);
    const out = new Uint8Array(enc.length + 4);
    out[0] = 1;
    out[1] = round & 255;
    out.set(enc, 4);
    this.takes.set(`${round}:${this.me}`, enc);
    this.conn && this.conn.sendBinary(out);
    this.wavebar.show(false);
    $('#goText').classList.remove('show');
    $('#caption').textContent = '';
    this.stage.setShot('wide');
    ui.clearCenter();
    ui.banner('جاري التحليل…', 'small sticky', 0);
    if (!hadMic) ui.toast('ما وصلنا صوتك — شغّل المايك من غرفة الانتظار', 3500);
  }

  onTake({ round, seat, data }) {
    const st = this.st;
    if (!st) return;
    const p = st.players[seat];
    if (!p) return;
    this.takes.set(`${round}:${p.uid}`, new Uint8Array(data));
    if (st.phase === 'analyze') this.maybeScore();
  }

  /* ================================================== التقييم (كل جهاز يقيّم الكل) */

  maybeScore() {
    const st = this.st;
    if (!st || st.phase !== 'analyze') return;
    const key = `${st.gameNo}:${st.round}`;
    if (this.scored.has(key)) return;
    const uids = st.takes;
    if (!uids.length) return;
    const r8 = st.round & 255;
    if (!uids.every((u) => this.takes.has(`${r8}:${u}`) || this.takes.has(`${st.round}:${u}`))) return;
    this.scored.add(key);
    const entry = this.refEntry;
    const ref = entry && (entry.feat || (entry.feat = analyze(entry.pcm)));
    const out = {};
    const list = [...uids];
    const step = () => {
      const uid = list.shift();
      if (uid === undefined) {
        if (ref) this.conn && this.conn.send({ t: 'scores', r: st.round, v: out });
        return;
      }
      const bytes = this.takes.get(`${r8}:${uid}`) || this.takes.get(`${st.round}:${uid}`);
      const pcm = mulawDecode(bytes);
      const sab = ((st.sab && st.sab[uid]) || []).map((s) => s.type);
      const seed = hashString(`${st.code}:${st.gameNo}:${st.round}:${uid}`);
      const silent = peakOf(pcm) < 0.006;
      const processed = applySabotage(pcm, sab, seed);
      this.processed.set(`${st.gameNo}:${st.round}:${uid}`, processed);
      if (ref) out[uid] = silent ? 0 : compare(ref, analyze(processed)).score;
      setTimeout(step, 0);
    };
    setTimeout(step, 30);
  }

  /* ================================================== الإعادة والدرجات */

  runPlayback(st) {
    ui.clearCenter();
    const results = st.results || {};
    const now = this.serverNow();
    for (const item of st.play || []) {
      const p = this.player(item.uid);
      if (!p) continue;
      if (now > item.at + (item.walk || 0) + (item.dur || 0) + T.REVEAL) {
        this.revealed.add(item.uid);
        continue;
      }
      if (item.none) {
        this.at(item.at, () => {
          this.setFocusLabel(null);
          ui.banner(`🤐 ${p.name} ما سجّل`, 'small', T.NOTAKE - 200);
          this.revealed.add(item.uid);
          this.renderCardsNow();
        });
        continue;
      }
      const res = results[item.uid] || { raw: 0, mult: 1, sab: [] };
      this.at(item.at, () => {
        this.stage.focus(item.uid);
        this.setFocusLabel(item.uid);
        this.audio.sfx('whoosh', 0.6);
      });
      this.at(item.at + item.walk, () => {
        this.setSpeakers([item.uid]);
        const key = `${st.gameNo}:${st.round}:${item.uid}`;
        let pcm = this.processed.get(key);
        if (!pcm) {
          const bytes = this.takes.get(`${st.round & 255}:${item.uid}`) || this.takes.get(`${st.round}:${item.uid}`);
          if (bytes) {
            const sab = ((st.sab && st.sab[item.uid]) || []).map((s) => s.type);
            pcm = applySabotage(mulawDecode(bytes), sab, hashString(`${st.code}:${st.gameNo}:${st.round}:${item.uid}`));
          }
        }
        if (pcm) {
          const { analyser } = this.audio.play(this.audio.pcmBuffer(pcm), null, { analyse: true, gain: 1.1 });
          this.talkers.set(item.uid, analyser);
          this.lastPlayback = { uid: item.uid, analyser, max: 0 };
        }
        if (res.sab && res.sab.length) {
          const by = ((st.sab && st.sab[item.uid]) || []).map((s) => (this.player(s.by) || {}).name).filter(Boolean);
          const names = res.sab.map((s) => `${SAB_INFO[s].icon} ${SAB_INFO[s].name}`).join(' + ');
          ui.banner(`😈 ${names}${by.length ? ' — من ' + [...new Set(by)].join(' و') : ''}`, 'small sab', Math.max(1200, item.dur));
          this.audio.sfx('sab', 0.5);
        }
      });
      this.at(item.at + item.walk + item.dur, () => {
        this.talkers.delete(item.uid);
        const ch = this.stage.char(item.uid);
        if (ch) {
          ch.talkTarget = 0;
          ch.setMood(res.raw >= 70 ? 'happy' : res.raw <= 15 ? 'sad' : 'idle', 1800);
        }
        this.setSpeakers([]);
        ui.clearCenter();
        ui.scoreBanner(res.raw, res.mult);
        this.audio.sfx('ding');
        if (item.uid === this.me) haptic(res.raw >= 50 ? 'success' : 'warning');
        this.revealed.add(item.uid);
        this.renderCardsNow();
      });
      this.at(item.at + item.walk + item.dur + T.REVEAL, () => {
        this.stage.unfocus(item.uid);
        this.setFocusLabel(null);
      });
    }
  }

  /* ================================================== العجلة */

  runWheel(st) {
    this.wheelLanded = false;
    this.setDim('soft');
    const box = $('#wheel');
    box.innerHTML = '';
    box.className = 'show';
    const holder = el('div', { class: 'wheel-holder', role: 'button', 'aria-label': 'دوّر العجلة' });
    const status = el('div', { class: 'wheel-status' });
    box.appendChild(holder);
    box.appendChild(status);
    this.wheel = new Wheel(holder);
    this.wheelUi = { status, holder };
    // العجلة تدور لوحدها (السيرفر يدوّرها أول ما تطلع)
    const mine = st.wheel && st.wheel[this.me];
    status.appendChild(el('div', { class: 'wheel-hint' }, mine ? 'جاري الدوران…' : 'تتفرّج هالجولة 👀'));
    this.updateWheel(st);
  }

  updateWheel(st) {
    if (!this.wheel || !st.wheel) return;
    const w = st.wheel[this.me];
    if (!w) return;
    const { status, holder } = this.wheelUi;
    if (w.seg != null && this.wheelSpunFor !== this.phaseKey) {
      this.wheelSpunFor = this.phaseKey;
      status.innerHTML = '';
      status.appendChild(el('div', { class: 'wheel-hint' }, 'جاري الدوران…'));
      const elapsed = this.serverNow() - (w.spunAt || this.serverNow());
      const dur = Math.max(1200, T.SPIN_ANIM - 300 - elapsed);
      this.wheel.spinTo(
        w.seg,
        dur,
        () => {
          this.audio.sfx('click');
          haptic('select');
        },
        () => {
          this.wheelLanded = true;
          const seg = WHEEL[w.seg];
          status.innerHTML = '';
          status.appendChild(el('div', { class: 'wheel-result ' + seg.kind }, seg.title));
          status.appendChild(el('div', { class: 'wheel-desc' }, seg.desc));
          this.audio.sfx(seg.kind === 'sab' ? 'sab' : 'win', 0.8);
          haptic(seg.kind === 'sab' ? 'heavy' : 'success');
          this.renderCardsNow();
          const cur = this.st && this.st.wheel && this.st.wheel[this.me];
          if (cur && cur.needTarget && !cur.done) setTimeout(() => this.beginTargeting(), 1300);
        },
      );
    }
    if (w.done && this.targeting) this.endTargeting(w.target);
    if (w.done && this.wheelLanded && !this.targeting) {
      const waiting = Object.values(st.wheel).filter((x) => !x.done).length;
      const note = status.querySelector('.wheel-wait') || status.appendChild(el('div', { class: 'wheel-wait' }));
      note.textContent = waiting ? `بانتظار ${waiting} لاعبين…` : 'الجولة الجاية بعد شوية…';
    }
  }

  beginTargeting() {
    const cur = this.st && this.st.wheel && this.st.wheel[this.me];
    if (!cur || cur.done || this.st.phase !== 'wheel') return;
    this.targeting = true;
    document.documentElement.dataset.targeting = '1';
    $('#wheel').classList.add('dim');
    this.setDim(null);
    this.stage.setShot('medium');
    ui.clearCenter();
    ui.banner('اختار واحد تخرّبله!', 'pick', 0);
    this.setTargeting(true);
  }

  endTargeting(targetUid) {
    this.setTargeting(false);
    this.targeting = false;
    delete document.documentElement.dataset.targeting;
    ui.clearCenter();
    this.stage.setShot('wide');
    $('#wheel').classList.remove('dim');
    if (this.st && this.st.phase === 'wheel') this.setDim('soft');
    const victim = this.player(targetUid);
    if (victim && this.wheelUi) this.wheelUi.status.appendChild(el('div', { class: 'wheel-desc' }, `😈 خرّبت على ${victim.name}`));
  }

  pickTarget(uid) {
    if (!this.targeting || uid === this.me) return;
    haptic('heavy');
    this.audio.sfx('sab');
    this.conn.send({ t: 'target', uid });
    this.endTargeting(uid);
  }

  hideWheel() {
    delete document.documentElement.dataset.targeting;
    const box = $('#wheel');
    box.className = '';
    box.innerHTML = '';
    this.wheel = null;
    this.wheelUi = null;
  }

  /* ================================================== النهاية */

  runFinal(st) {
    const f = st.finals || [];
    const isHost = st.host === this.me;
    const winner = f[0];
    for (const r of f) {
      const c = this.stage.char(r.uid);
      if (c) c.setMood(r.rank === 1 ? 'happy' : 'idle', 8000);
    }
    this.audio.sfx('win');
    const podium = el(
      'div',
      { class: 'podium' },
      [f[1], f[0], f[2]]
        .filter(Boolean)
        .map((r) =>
          el(
            'div',
            { class: `pod pod${r.rank}` },
            el('div', { class: 'pod-medal' }, ['🥇', '🥈', '🥉'][r.rank - 1] || ''),
            el('div', { class: 'pod-name' }, r.name),
            el('div', { class: 'pod-score' }, `${r.score}`),
            el('div', { class: 'pod-block' }, String(r.rank)),
          ),
        ),
    );
    const rest = f.slice(3).map((r) => el('div', { class: 'rest-row' }, `${r.rank}. ${r.name} — ${r.score}`));
    const confetti = el(
      'div',
      { class: 'confetti' },
      Array.from({ length: 36 }, (_, i) =>
        el('i', { style: { left: `${(i * 97) % 100}%`, animationDelay: `${(i % 12) * 0.12}s`, background: ['#ff4f8b', '#ffd60a', '#3a86ff', '#7ed321', '#ff8c1a'][i % 5] } }),
      ),
    );
    const panel = el(
      'div',
      { class: 'final' },
      confetti,
      el('div', { class: 'final-title bubble' }, winner && winner.score > 0 ? `🏆 ${winner.name} فاز!` : 'خلصت اللعبة!'),
      podium,
      rest.length ? el('div', { class: 'rest' }, rest) : null,
      el(
        'div',
        { class: 'final-btns' },
        isHost ? el('button', { class: 'btn pink big', onclick: () => this.start() }, '🔁 لعبة جديدة') : el('div', { class: 'lobby-wait' }, '⏳ المضيف يكدر يبدي لعبة جديدة'),
        el('button', { class: 'btn blue', onclick: () => this.shareResult() }, '📤 شارك النتيجة'),
        el('button', { class: 'btn ghost', onclick: () => this.leave() }, '🏠 القائمة'),
      ),
    );
    ui.overlay(panel, 'final-layer');
  }

  shareResult() {
    const f = (this.st && this.st.finals) || [];
    const medal = ['🥇', '🥈', '🥉'];
    const lines = f.map((r) => `${medal[r.rank - 1] || r.rank + '.'} ${r.name} — ${r.score}`).join('\n');
    shareText(this.inviteLink(), `🎤 نتيجة «قلّدها»:\n${lines}\n\nتگدر تغلبنا؟ 😏`);
  }

  /* ================================================== أسماء فوق الشخصيات */

  syncLabels() {
    const st = this.st;
    const layer = $('#labels');
    const ids = new Set(st.players.map((p) => p.uid));
    for (const [uid, l] of this.labels) {
      if (!ids.has(uid)) {
        l.el.remove();
        l.hit.remove();
        l.fx.remove();
        this.labels.delete(uid);
      }
    }
    for (const p of st.players) {
      let l = this.labels.get(p.uid);
      if (!l) {
        const name = el('div', { class: 'plabel-name' });
        const spk = el('div', { class: 'plabel-spk', html: SPEAKER_SVG });
        const arrow = el('div', { class: 'plabel-me' });
        const lab = el('div', { class: 'plabel' }, spk, name, arrow);
        const hit = el('div', { class: 'phit', onclick: () => this.pickTarget(p.uid) });
        const fx = el('div', { class: 'pfx' });
        layer.appendChild(lab);
        layer.appendChild(hit);
        layer.appendChild(fx);
        l = { el: lab, name, spk, hit, fx };
        this.labels.set(p.uid, l);
      }
      l.name.textContent = p.name;
      l.el.classList.toggle('me', p.uid === this.me);
      l.el.classList.toggle('off', p.on === false);
    }
  }

  /** وقت الإعادة يبين اسم اللي على المايك بس (مثل الأصلية) */
  setFocusLabel(uid) {
    for (const [id, l] of this.labels) l.el.classList.toggle('focus', id === uid);
  }

  setSpeakers(uids) {
    const set = new Set(uids);
    for (const [uid, l] of this.labels) l.spk.classList.toggle('on', set.has(uid));
  }

  setTargeting(on) {
    for (const [uid, l] of this.labels) {
      const can = on && uid !== this.me;
      l.hit.classList.toggle('on', can);
      const c = this.stage.char(uid);
      if (c) c.setHighlight(can ? '#ff2b2b' : null);
    }
  }

  showReaction(uid, e) {
    const l = this.labels.get(uid);
    if (!l) return;
    const b = el('div', { class: 'react-bubble' }, e);
    l.fx.appendChild(b);
    setTimeout(() => b.remove(), 1600);
  }

  sendReaction(e) {
    if (!this.conn) return;
    haptic('light');
    this.conn.send({ t: 'react', e });
  }

  /* ================================================== كل فريم */

  onFrame() {
    if (!this.active || !this.st) return;
    const H = this.stage.h || 1;
    for (const [uid, l] of this.labels) {
      const p = this.stage.screenPos(uid);
      if (!p) continue;
      // حجم الاسم يتبع حجم الشخصية على الشاشة (لقطة واسعة صغير، قريبة كبير)
      const charH = Math.max(10, p.feetY - p.y);
      const fs = Math.max(11, Math.min(H * 0.072, charH * 0.19));
      l.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      l.el.style.fontSize = fs.toFixed(1) + 'px';
      l.fx.style.transform = l.el.style.transform;
      const h = Math.max(40, charH);
      l.hit.style.transform = `translate(${p.x - h * 0.3}px, ${p.y}px)`;
      l.hit.style.width = `${h * 0.6}px`;
      l.hit.style.height = `${h}px`;
    }
    for (const [uid, an] of this.talkers) {
      const c = this.stage.char(uid);
      const lv = AudioEngine.level(an);
      if (c) c.talkTarget = lv;
      if (this.lastPlayback && this.lastPlayback.uid === uid) this.lastPlayback.max = Math.max(this.lastPlayback.max, lv);
    }
    if (this.progressAnim) {
      const now = this.serverNow();
      const { from, to, t0, t1, fill } = this.progressAnim;
      const f = Math.max(0, Math.min(1, (now - from) / Math.max(1, to - from)));
      const tm = t0 + f * (t1 - t0);
      this.wavebar.time = tm;
      if (fill) this.wavebar.fillTo = tm;
    }
    if (this.wavebar.root.classList.contains('show')) this.wavebar.draw();
  }
}

export { REACTIONS, ROUNDS };
