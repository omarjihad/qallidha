// متحكّم اللعبة: يحوّل حالة السيرفر إلى صوت وحركة وواجهة، بتوقيت متزامن عند الكل.
// اللقطات مثل الأصلية: لقطة واسعة للمسرح، شاشة المثال، «حاول تقلّدها»، ولقطة قريبة لشخصيتك وقت التسجيل.

import { T, WHEEL, SAB_INFO, REACTIONS, ROUNDS, MAX_PLAYERS, isTargeted } from './shared.js';
import { SR, mulawEncode, mulawDecode, hashString, peakOf } from './dsp.js';
import { analyze, compare } from './scorer.js';
import { applySabotage } from './effects.js';
import { RoomConnection } from './net.js';
import { AudioEngine } from './audio.js';
import { Wheel } from './wheel.js';
import * as ui from './ui.js';
import { $, el } from './ui.js';
import { haptic, closingConfirmation, backButton, shareText } from './tg.js';
import { t } from './i18n.js';
import { VoiceChat } from './voice.js';

// مهلة قبل بداية موجة المثال داخل نافذة التسجيل (ثواني) — الناس تبدي متأخرة شوية بعد «يلا!»
const LEAD = 0.25;

const SPEAKER_SVG =
  '<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#34d12c" stroke="#0f5a0c" stroke-width="1.1" d="M3 9h4l5-4v14l-5-4H3z"/><path fill="none" stroke="#34d12c" stroke-width="2.4" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

const gameKeyOf = (st) => `${st.code}:${st.gameNo}`;

// رسائل أخطاء الغرفة حسب الكود (حتى تترجم)
const ROOM_ERRORS = {
  started: 'اللعبة بدأت بهاي الغرفة — انتظر تخلص أو سوّي غرفة جديدة',
  full: 'الغرفة مليانة (5 لاعبين)',
  notfound: 'ماكو غرفة بهالكود 🤷 تأكد من الرقم',
  kicked: 'المضيف طلّعك من الغرفة',
  nosounds: 'ماكو ولا صوت شغّال 😕 الأدمن يفعّل أصوات من البوت بأمر /sounds',
  banned: '🚫 حسابك محظور من اللعبة',
  maint: '🛠️ اللعبة بالصيانة هسه — نرجع قريب',
};
// أخطاء تطلّع من الغرفة
const FATAL = ['started', 'full', 'kicked', 'notfound', 'banned', 'maint'];

export class Game {
  constructor({ stage, audio, config, meta, onExit, pub = false, onRetry = null, onQuick = null }) {
    this.stage = stage;
    this.meta = meta || null;
    /** @type {AudioEngine} */
    this.audio = audio;
    this.config = config || {};
    this.onExit = onExit;
    // لعب عشوائي (غرفة عامة): إذا الغرفة امتلت/بدت نجرّب غيرها، وبالنهاية «🎲 غرفة ثانية»
    this.pub = !!pub;
    this.onRetry = onRetry;
    this.onQuick = onQuick;
    this.tickTimer = null;
    this.micSent = false;
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
    // الدردشة الصوتية بالغرفة
    this.voice = new VoiceChat(audio, {
      getConn: () => this.conn,
      seatUid: (seat) => (this.st && this.st.players[seat] ? this.st.players[seat].uid : null),
      onChange: () => this.renderChatBtn(),
    });
    this.chatTalk = new Set();
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
      take: (x) => this.onTake(x),
      voice: (x) => this.voice.receive(x.seat, x.data),
      react: (m) => this.showReaction(m.uid, m.e),
      error: (m) => {
        // لعب عشوائي: الغرفة امتلت أو بدت قبل ما نوصل — نروح لغيرها بدون ما نزعج اللاعب
        if (this.pub && this.onRetry && !this.st && ['started', 'full', 'notfound'].includes(m.code)) {
          const retry = this.onRetry;
          this.onRetry = null;
          if (this.conn) this.conn.close();
          this.conn = null;
          retry(code, m.code);
          return;
        }
        ui.toast(t(ROOM_ERRORS[m.code] || m.m || 'صار خطأ'), 3500);
        if (FATAL.includes(m.code)) setTimeout(() => this.leave(true), 600);
      },
      status: (s) => this.onStatus(s),
    });
    this.voice.start();
    backButton(() => this.askLeave());
    clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => this.tick(), 500);
  }

  async askLeave() {
    const inGame = this.st && this.st.phase !== 'lobby' && this.st.phase !== 'final';
    const ok = !inGame || (await ui.confirmDialog(t('تطلع من اللعبة؟ نقاطك تبقى بس ما راح تكمّل الجولات.'), t('إي اطلع'), t('لا')));
    if (ok) this.leave();
  }

  leave(silent = false) {
    this.active = false;
    // الدردشة تتسكّر أول (حتى المايك يتسكّر بعدها إذا لازم)
    this.voice.dispose();
    this.chatTalk.clear();
    this.renderChatBtn();
    this.clearTimers();
    clearInterval(this.tickTimer);
    this.tickTimer = null;
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
      ind.textContent = s === 'connecting' ? t('جاري الاتصال…') : t('جاري إعادة الاتصال…');
    } else if (s === 'lost') {
      ind.className = 'show bad';
      ind.textContent = t('انقطع الاتصال 😕');
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
    if (st.pub) this.pub = true;
    // المايك انفتح قبل (مثلًا من زر اللعب العشوائي): نبلّغ الغرفة
    if (!this.micSent && this.audio.micState === 'on' && st.phase === 'lobby' && this.conn) {
      this.micSent = true;
      this.conn.send({ t: 'mic', ok: true });
    }
    // اللاعبين يدخلون يمشون من اليسار ويوكفون بالصف (أول ما تدخل الغرفة، وكل ما يدخل واحد جديد)
    this.stage.setPlayers(
      st.players.map((p) => ({ uid: p.uid, skin: p.skin, acc: p.acc || null })),
      { enter: true },
    );
    this.stage.setTheme(st.stage || 'stage:classic');
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
      let { mult, bonus } = p;
      if (st.phase === 'wheel' && st.wheel && st.wheel[p.uid]) {
        const w = st.wheel[p.uid];
        const mine = p.uid === this.me;
        const seg = w.seg != null ? WHEEL[w.seg] : null;
        const shown = mine ? this.wheelLanded : true;
        if (seg && shown) badges[p.uid] = isTargeted(seg) ? (mine ? seg.icon : '😈') : seg.label;
        else if (!mine && w.kind === 'sab') badges[p.uid] = '😈';
        // نتيجتي ما تبين على كارتي قبل ما توكف عجلتي
        if (mine && !this.wheelLanded) {
          mult = 1;
          bonus = 0;
        }
      }
      return { ...p, score, mult, bonus };
    });
    ui.renderCards(players, { me: this.me, host: st.host, gains, badges, muted: this.voice.muted });
  }

  /* ================================================== الدردشة الصوتية */

  /** زر المايك: 🎙️ شغّال، 🔇 طافي، 🔒 مسدود وقت التقليد */
  renderChatBtn() {
    const b = $('#chatBtn');
    if (!b) return;
    const s = this.active ? this.voice.state : 'hidden';
    b.dataset.state = s;
    b.classList.toggle('live', s === 'on' && this.voice.sending);
    b.textContent = s === 'off' ? '🔇' : s === 'lock' ? '🔒' : '🎙️';
    b.setAttribute(
      'aria-label',
      s === 'on' ? t('🎙️ مايكك شغّال — ربعك يسمعونك') : s === 'lock' ? t('🔒 المايك مسدود وقت التقليد') : t('🔇 مايكك مسكّر'),
    );
    // أول مرة: نعرّفه شلون يشتغل
    if (s === 'on' && !this.voiceHinted) {
      this.voiceHinted = true;
      let seen = false;
      try {
        seen = localStorage.getItem('qd_voice_hint') === '1';
        localStorage.setItem('qd_voice_hint', '1');
      } catch {
        /* */
      }
      if (!seen) ui.toast(t('🎙️ الدردشة الصوتية شغّالة: ربعك يسمعونك — زر 🎙️ يسكّر مايكك، ودوس على كارت لاعب حتى تكتمه'), 5000);
    }
  }

  async toggleChat() {
    haptic('light');
    if (this.voice.locked) return ui.toast(t('🔒 المايك مسدود وقت التقليد — يرجع بعد التسجيل'), 2500);
    const on = await this.voice.toggle();
    if (on && this.audio.micState !== 'on') {
      ui.toast(this.audio.micState === 'denied' ? t('المايك مرفوض — اسمح لتيليجرام يستخدم المايك من إعدادات الجهاز') : t('ما كدرنا نشغّل المايك'), 4000);
      return;
    }
    if (on && this.conn && this.st && this.st.phase === 'lobby') this.conn.send({ t: 'mic', ok: true });
    ui.toast(on ? t('🎙️ مايكك شغّال — ربعك يسمعونك') : t('🔇 سكّرت مايكك — بعدك تسمع ربعك'), 2200);
    if (this.st && this.st.phase === 'lobby') this.renderLobbyBar();
  }

  /** دوس على كارت لاعب: تكتمه (عندك بس) أو ترجّعه */
  toggleMutePlayer(uid) {
    if (!this.st || uid === this.me || !this.voice.enabled) return;
    const p = this.player(uid);
    if (!p) return;
    haptic('select');
    const muted = this.voice.toggleMute(uid);
    ui.toast(muted ? t('🔇 كتمت صوت {name}', { name: p.name }) : t('🔊 رجّعت صوت {name}', { name: p.name }), 1800);
    this.renderCardsNow();
  }

  /** كل فريم: مين يحچي (الكارت يضوي وتمه يتحرك) */
  voiceFrame() {
    const cards = $('#cards').children;
    for (const card of cards) {
      const uid = card.dataset.uid;
      const talking = this.voice.talking(uid, this.me);
      card.classList.toggle('talking', talking);
      if (this.talkers.has(uid)) continue;
      const c = this.stage.char(uid);
      if (talking) {
        this.chatTalk.add(uid);
        if (c) c.talkTarget = Math.max(0.25, this.voice.level(uid, this.me));
      } else if (this.chatTalk.has(uid)) {
        this.chatTalk.delete(uid);
        if (c && !(this.st && this.st.phase === 'perform' && uid === this.me)) c.talkTarget = 0;
      }
    }
  }

  enterPhase(st) {
    this.clearTimers();
    ui.clearCenter();
    this.setCount('');
    $('#goText').classList.remove('show');
    document.documentElement.dataset.phase = st.phase;
    this.voice.setPhase(st.phase);
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
    // المتجر المفتوح من غرفة الانتظار يتسكّر ويا بداية اللعبة
    if (st.phase !== 'lobby' && this.meta) this.meta.onLook = null;
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
        ui.banner(t('الجولة {r} من {n}', { r: st.round, n: st.rounds }), 'bubble round', 2200);
        this.audio.sfx('whoosh');
        break;
      case 'perform':
        this.runPerform(st);
        break;
      case 'analyze':
        ui.banner(t('جاري التحليل…'), 'small sticky', 0);
        this.maybeScore();
        break;
      case 'playback':
        this.runPlayback(st);
        break;
      case 'wheel':
        this.runWheel(st);
        break;
      case 'final':
        $('#hudInfo').appendChild(el('div', { class: 'pill dim' }, t('الغرفة {code}', { code: st.code })));
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
      bar.appendChild(el('div', { class: 'lobby-wait' }, t('جاري الدخول للغرفة…')));
      return;
    }
    const st = this.st;
    const isHost = st.host === this.me;
    const mic = this.audio.micState;
    const micOk = mic === 'on' || (this.player(this.me) || {}).mic;
    const n = st.players.length;
    const pub = !!st.pub;
    const sig = [isHost, micOk, mic, n, st.code, pub].join('|');
    if (sig !== this.lobbySig || !bar.firstChild) {
      this.lobbySig = sig;
      bar.innerHTML = '';
      let startEl;
      if (isHost) {
        const label = n < 2 ? t('▶️ ابدأ (وحدك)') : pub ? t('▶️ ابدأ هسه') : t('▶️ ابدأ اللعبة');
        startEl = el('button', { class: 'btn pink big', onclick: () => this.start() }, label);
      } else startEl = el('div', { class: 'lobby-wait' }, pub ? t('🎲 غرفة عشوائية') : t('⏳ بانتظار المضيف يبدي…'));
      bar.appendChild(
        el(
          'div',
          { class: 'lobby-row' },
          el('div', { class: 'room-code' + (pub ? ' pub' : '') }, el('small', {}, pub ? t('🎲 عشوائي') : t('كود الغرفة')), el('b', {}, st.code)),
          el('button', { class: 'btn blue', onclick: () => this.invite() }, t('📨 ادعُ ربعك')),
          el('button', { class: 'btn purple', onclick: () => this.changeLook() }, this.meta && this.meta.tg ? t('🎭 لبسي') : t('🎭 غيّر شكلك')),
          el(
            'button',
            { class: 'btn ' + (micOk ? 'green' : 'orange pulse'), onclick: () => this.enableMic() },
            micOk ? t('🎤 المايك جاهز') : mic === 'denied' ? t('🚫 المايك مرفوض') : t('🎤 فعّل المايك'),
          ),
          startEl,
        ),
      );
    }
    this.updateLobbyHint();
  }

  /** النص فوق شريط الغرفة: دعوة الربع، أو بالعشوائي: ندوّر لاعبين / تبدي بعد كذا ثانية */
  lobbyHintText() {
    const st = this.st;
    const n = st.players.length;
    if (!st.pub) return n < 2 ? t('ادعُ ربعك — لحد 5 لاعبين 🎤') : t('{n} لاعبين بالغرفة', { n });
    if (st.autoAt) {
      const s = Math.ceil((st.autoAt - this.serverNow()) / 1000);
      return s > 0 ? t('⏳ اللعبة تبدي بعد {s} ثانية ({n}/{max})', { s, n, max: MAX_PLAYERS }) : t('🚀 تبدي هسه…');
    }
    return t('🔎 ندوّر لاعبين… ({n}/{max})', { n, max: MAX_PLAYERS });
  }

  updateLobbyHint() {
    if (!this.st || this.st.phase !== 'lobby') return;
    const center = $('#center');
    const txt = this.lobbyHintText();
    const hint = center.querySelector('.lobby-hint');
    if (hint) {
      if (hint.textContent !== txt) hint.textContent = txt;
    } else {
      ui.clearCenter();
      center.appendChild(el('div', { class: 'lobby-hint' + (this.st.pub ? ' pub' : '') }, txt));
    }
    if (hint) hint.classList.toggle('pub', !!this.st.pub);
  }

  /** عدّادات الغرفة العامة (البداية والجولة الجاية) كل نص ثانية */
  tick() {
    const st = this.st;
    if (!this.active || !st || !st.pub) return;
    if (st.phase === 'lobby') this.updateLobbyHint();
    if (st.phase === 'final') {
      const box = document.querySelector('.final .next-game');
      if (box && st.t && st.t.againAt) {
        const s = Math.max(0, Math.ceil((st.t.againAt - this.serverNow()) / 1000));
        const txt = t('⏳ اللعبة الجاية بعد {s} ثانية…', { s });
        if (box.textContent !== txt) box.textContent = txt;
      }
    }
  }

  inviteLink() {
    const c = this.config;
    if (c.bot) return `https://t.me/${c.bot}${c.appShort ? '/' + c.appShort : ''}?startapp=r${this.st.code}`;
    return `${location.origin}/?room=${this.st.code}`;
  }

  invite() {
    haptic('light');
    shareText(this.inviteLink(), t('🎤 تعال العب وياي «قلّدها» — لعبة تقليد الأصوات!\nكود الغرفة: {code}', { code: this.st.code }));
  }

  /** لاعب تيليجرام: يفتح المتجر (لبسه)، الضيف: يبدّل بين الشخصيات المجانية */
  changeLook() {
    if (!this.meta || !this.meta.tg) return this.nextSkin();
    haptic('light');
    this.meta.onLook = () => this.conn && this.conn.send({ t: 'look' });
    this.meta.openShop({
      tab: 'skin',
      onClose: () => {
        this.meta.onLook = null;
        ui.closeOverlay();
        this.conn && this.conn.send({ t: 'look' });
      },
    });
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
      ui.toast(t('🎤 المايك اشتغل'));
      this.conn.send({ t: 'mic', ok: true });
      if (this.audio.releaseAfterRecord) this.audio.closeMic();
    } else {
      haptic('error');
      ui.toast(this.audio.micState === 'denied' ? t('المايك مرفوض — اسمح لتيليجرام يستخدم المايك من إعدادات الجهاز') : t('ما كدرنا نشغّل المايك'), 4000);
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
            ui.toast(t('ما كدرنا نحمّل الصوت 😕'));
            this.conn && this.conn.send({ t: 'loaded', r: st.round, dur: -1 });
          },
        );
      }
    });
  }

  /* ================================================== الأداء: اسمع ← حاول تقلّدها ← عد ← سجّل */

  async runPerform(st) {
    const tl = st.t;
    const sound = st.sound || {};
    const round = st.round;
    const late0 = this.serverNow() > tl.countAt;

    // 1) ستارة عنابية + «حاول.. تقلّدها!» تطير حروفها (مثل الأصلية) والمثال يشتغل وياها
    if (!late0) {
      this.setDim('full');
      ui.reproduceBanner(Math.max(500, tl.countAt - this.serverNow() - 60));
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
    const late = now > tl.recAt + 300;
    const dur = Math.max(0.2, (tl.listenEnd - tl.listenAt) / 1000);
    const win = tl.recDur / 1000;

    this.wavebar.setRef(entry ? entry.peaks : null, dur, win, LEAD);
    this.wavebar.mode = 'listen';
    this.wavebar.show(true);
    $('#caption').textContent = sound.title
      ? `${sound.emoji ? sound.emoji + ' ' : ''}${sound.title}${sound.by ? ' · ' + t('من {name}', { name: sound.by }) : ''}`
      : '';
    const media = now < tl.countAt ? ui.showMeme(sound, entry) : null;
    if (entry && now < tl.listenEnd) {
      if (!this.audio.running) this.tapToHear(entry, tl);
      this.audio.play(entry.buffer, this.ctxTime(tl.listenAt));
      if (media && media.tagName === 'VIDEO') {
        this.at(tl.listenAt, () => {
          try {
            media.currentTime = entry.offset || 0;
            media.play().catch(() => null);
          } catch {
            /* */
          }
        });
      }
    }
    this.progressAnim = { from: tl.listenAt, to: tl.listenEnd, t0: LEAD, t1: LEAD + dur, fill: false };

    // المايك ينفتح بعد ما يخلص المثال (حتى ما يلقط الصوت من السماعة)
    this.at(tl.reproduceAt, () => {
      if (this.audio.micState !== 'on')
        this.audio.openMic().then((ok) => {
          if (!ok) return;
          this.conn && this.conn.send({ t: 'mic', ok: true });
          if (this.serverNow() >= tl.countAt) this.armIfNeeded();
        });
    });

    // 2) العد: الستارة تنشال والكاميرا تقرب على شخصيتك، والأرقام على الشريط
    this.at(tl.countAt, () => {
      ui.clearCenter();
      ui.hideMeme();
      this.setDim(null);
      this.stage.setShot('closeup', this.me);
      this.progressAnim = null;
      this.wavebar.mode = 'count';
      this.wavebar.time = 0;
      this.wavebar.fillTo = -1;
      $('#caption').textContent = t('الكل سوا — فرصة وحدة بس!');
    });
    for (let k = 0; k < 3; k++) {
      this.at(tl.countAt + k * T.COUNT_STEP, () => {
        this.setCount(String(3 - k));
        this.audio.sfx('tick');
        haptic('light');
      });
    }
    this.at(tl.countAt + T.COUNT_STEP, () => this.armIfNeeded());

    // 3) يلا! — التسجيل: المؤشر يمشي والموجة تتلوّن زرقاء
    this.at(tl.recAt, () => {
      this.armIfNeeded();
      this.setCount('');
      $('#caption').textContent = '';
      $('#goText').classList.add('show');
      this.audio.sfx('go');
      haptic('medium');
      this.wavebar.mode = 'record';
      this.progressAnim = { from: tl.recAt, to: tl.recEnd, t0: 0, t1: win, fill: true };
      const mine = this.stage.char(this.me);
      for (const [uid, c] of this.stage.chars) if (uid !== this.me) c.setMood('sing', tl.recDur);
      this.audio.onChunk = (time, d) => {
        let p = 0;
        for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
        if (mine) mine.talkTarget = Math.min(1, p * 3);
      };
    });

    // 4) انتهى ← إرسال
    this.at(tl.recEnd + 120, () => this.finishTake(st, late));
  }

  /** الصوت مقفول (ما صارت لمسة بعد): زر كبير يفتحه ويشغّل المثال من مكانه. */
  tapToHear(entry, tl) {
    if ($('#tapAudio')) return;
    const b = el(
      'button',
      {
        id: 'tapAudio',
        class: 'btn pink big',
        onclick: async () => {
          await this.audio.unlock();
          b.remove();
          if (this.serverNow() < tl.listenEnd) this.audio.play(entry.buffer, this.ctxTime(tl.listenAt));
        },
      },
      t('🔊 اضغط حتى تسمع'),
    );
    $('#app').appendChild(b);
    setTimeout(() => b.remove(), Math.max(1500, tl.listenEnd - this.serverNow() + 500));
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
    ui.banner(t('جاري التحليل…'), 'small sticky', 0);
    if (!hadMic) ui.toast(t('ما وصلنا صوتك — شغّل المايك من غرفة الانتظار'), 3500);
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
      const reveal = item.reveal || T.REVEAL;
      if (now > item.at + (item.walk || 0) + (item.dur || 0) + reveal) {
        this.revealed.add(item.uid);
        continue;
      }
      const src = item.src || item.uid;
      const srcP = this.player(src);
      const swapped = src !== item.uid;
      const resN = results[item.uid] || {};
      if (item.none) {
        this.at(item.at, () => {
          this.setFocusLabel(null);
          const who = swapped && srcP ? t('🔄 {a} أخذ صوت {b} — وهو ما سجّل 🤐', { a: p.name, b: srcP.name }) : t('🤐 {name} ما سجّل', { name: p.name });
          ui.banner(resN.bonus ? `${who} · +${resN.bonus}` : who, 'small', T.NOTAKE - 200);
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
        if (swapped && srcP) {
          ui.banner(t('🔄 {a} أخذ صوت {b}!', { a: p.name, b: srcP.name }), 'small swap', Math.max(1400, item.walk + 600));
          this.audio.sfx('sab', 0.4);
        }
      });
      this.at(item.at + item.walk, () => {
        this.setSpeakers([item.uid]);
        // التسجيل اللي ينعاد = تسجيل المصدر (نفسه، أو اللي انبدل وياه)
        const key = `${st.gameNo}:${st.round}:${src}`;
        let pcm = this.processed.get(key);
        if (!pcm) {
          const bytes = this.takes.get(`${st.round & 255}:${src}`) || this.takes.get(`${st.round}:${src}`);
          if (bytes) {
            const sab = ((st.sab && st.sab[src]) || []).map((s) => s.type);
            pcm = applySabotage(mulawDecode(bytes), sab, hashString(`${st.code}:${st.gameNo}:${st.round}:${src}`));
          }
        }
        if (pcm) {
          const { analyser } = this.audio.play(this.audio.pcmBuffer(pcm), null, { analyse: true, gain: 1.1 });
          this.talkers.set(item.uid, analyser);
          this.lastPlayback = { uid: item.uid, analyser, max: 0 };
        }
        if (res.sab && res.sab.length) {
          const by = ((st.sab && st.sab[src]) || []).map((s) => (this.player(s.by) || {}).name).filter(Boolean);
          const names = res.sab.map((s) => `${SAB_INFO[s].icon} ${t(SAB_INFO[s].name)}`).join(' + ');
          ui.banner(by.length ? t('😈 {what} — من {who}', { what: names, who: [...new Set(by)].join(t(' و')) }) : `😈 ${names}`, 'small sab', Math.max(1200, item.dur));
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
        const mine = item.uid === this.me;
        // الدرجة توكف، وبعدها المضاعف ونقاط العجلة تنضاف قدّام الكل (40/100 ← 50/100)
        ui.scoreBanner(res.raw, res.mult || 1, res.bonus || 0, {
          ms: reveal - 200,
          stepMs: T.BONUS_STEP,
          onStep: (kind) => {
            this.audio.sfx(kind === 'mult' ? 'win' : 'ding', 0.7);
            if (mine) haptic('success');
          },
        });
        this.audio.sfx('ding');
        if (mine) haptic(res.raw >= 50 ? 'success' : 'warning');
        // الكارت يتحدّث بالمجموع بعد ما تخلص الإضافات
        const settle = (res.mult || 1) > 1 || (res.bonus || 0) > 0 ? ui.scoreSettleMs(res.mult || 1, res.bonus || 0, T.BONUS_STEP) : 0;
        const reveal1 = () => {
          this.revealed.add(item.uid);
          this.renderCardsNow();
        };
        if (settle) this.at(item.at + item.walk + item.dur + settle, reveal1);
        else reveal1();
      });
      this.at(item.at + item.walk + item.dur + reveal, () => {
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
    const holder = el('div', { class: 'wheel-holder', role: 'button', 'aria-label': t('دوّر العجلة') });
    const status = el('div', { class: 'wheel-status' });
    box.appendChild(holder);
    box.appendChild(status);
    this.wheel = new Wheel(holder);
    this.wheelUi = { status, holder };
    // العجلة تدور لوحدها (السيرفر يدوّرها أول ما تطلع)
    const mine = st.wheel && st.wheel[this.me];
    status.appendChild(el('div', { class: 'wheel-hint' }, mine ? t('جاري الدوران…') : t('تتفرّج هالجولة 👀')));
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
      status.appendChild(el('div', { class: 'wheel-hint' }, t('جاري الدوران…')));
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
          status.appendChild(el('div', { class: 'wheel-result ' + seg.kind }, t(seg.title)));
          status.appendChild(el('div', { class: 'wheel-desc' }, t(seg.desc)));
          this.audio.sfx(isTargeted(seg) ? 'sab' : 'win', 0.8);
          haptic(isTargeted(seg) ? 'heavy' : 'success');
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
      note.textContent = waiting ? t('بانتظار {n} لاعبين…', { n: waiting }) : t('الجولة الجاية بعد شوية…');
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
    const seg = WHEEL[cur.seg];
    ui.banner(seg && seg.kind === 'swap' ? t('🔄 اختار واحد تبدّل صوتك وياه!') : t('اختار واحد تخرّبله!'), 'pick', 0);
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
    const mine = this.st && this.st.wheel && this.st.wheel[this.me];
    const swap = mine && mine.seg != null && WHEEL[mine.seg].kind === 'swap';
    if (victim && this.wheelUi)
      this.wheelUi.status.appendChild(el('div', { class: 'wheel-desc' }, swap ? t('🔄 بالجولة الجاية تاخذ صوت {name}', { name: victim.name }) : t('😈 خرّبت على {name}', { name: victim.name })));
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
    const mine = f.find((r) => r.uid === this.me);
    const rewardsSlot = el('div', { class: 'rewards-slot' });
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
      el('div', { class: 'final-title bubble' }, winner && winner.score > 0 ? t('🏆 {name} فاز!', { name: winner.name }) : t('خلصت اللعبة!')),
      el('div', { class: 'final-mid' }, podium, rewardsSlot),
      rest.length ? el('div', { class: 'rest' }, rest) : null,
      st.pub
        ? // العشوائي: اللي يبقى يلعب الجاية ويا ناس جدد، أو يروح لغرفة ثانية
          el(
            'div',
            { class: 'final-btns' },
            el('div', { class: 'lobby-wait next-game' }, t('⏳ اللعبة الجاية بعد {s} ثانية…', { s: Math.max(0, Math.ceil((((st.t && st.t.againAt) || 0) - this.serverNow()) / 1000)) })),
            el(
              'button',
              {
                class: 'btn pink',
                onclick: () => {
                  const from = this.st && this.st.code;
                  const quick = this.onQuick;
                  this.leave(true);
                  if (quick) quick(from);
                },
              },
              t('🎲 غرفة ثانية'),
            ),
            el('button', { class: 'btn blue', onclick: () => this.shareResult() }, t('📤 شارك النتيجة')),
            el('button', { class: 'btn ghost', onclick: () => this.leave() }, t('🏠 القائمة')),
          )
        : el(
            'div',
            { class: 'final-btns' },
            isHost ? el('button', { class: 'btn pink big', onclick: () => this.start() }, t('🔁 لعبة جديدة')) : el('div', { class: 'lobby-wait' }, t('⏳ المضيف يكدر يبدي لعبة جديدة')),
            el('button', { class: 'btn blue', onclick: () => this.shareResult() }, t('📤 شارك النتيجة')),
            el('button', { class: 'btn ghost', onclick: () => this.leave() }, t('🏠 القائمة')),
          ),
    );
    ui.overlay(panel, 'final-layer');
    // مكافآتي (مايكات، لفل، باس) + زر المضاعفة، وبعدها إعلان نهاية اللعبة
    if (this.meta && mine && mine.reward) {
      const gameNo = st.gameNo;
      this.meta.refresh().then(() => {
        if (!this.st || this.st.phase !== 'final' || this.st.gameNo !== gameNo) return;
        const strip = this.meta.rewardsStrip(mine.reward);
        if (strip) rewardsSlot.appendChild(strip);
      });
    }
    if (this.meta && this.adShownFor !== gameKeyOf(st)) {
      this.adShownFor = gameKeyOf(st);
      setTimeout(() => {
        if (this.active && this.st && this.st.phase === 'final' && this.meta) this.meta.ads.showInterstitial();
      }, 2600);
    }
  }

  shareResult() {
    const f = (this.st && this.st.finals) || [];
    const medal = ['🥇', '🥈', '🥉'];
    const lines = f.map((r) => `${medal[r.rank - 1] || r.rank + '.'} ${r.name} — ${r.score}`).join('\n');
    shareText(this.inviteLink(), t('🎤 نتيجة «قلّدها»:\n{lines}\n\nتگدر تغلبنا؟ 😏', { lines }));
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
    // اللاعب طفّى التفاعلات من الإعدادات: نشوف بس تفاعلاتي
    if (document.documentElement.dataset.reactions === 'off' && uid !== this.me) return;
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
    this.voiceFrame();
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
