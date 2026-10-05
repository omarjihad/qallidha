// دردشة صوتية بالغرفة: اللاعبين يحچون ويا بعض، والمايك ينسد لوحده وقت المثال والتسجيل (مثل الأصلية).
// الصوت: 8kHz بترميز IMA ADPCM (4 بت) بقطع 200ms عبر نفس اتصال الغرفة (رسائل نوع 3).
// يرسل بس وقت الحچي (كاشف صوت)، وما يرسل وقت يطلع صوت من السماعة (حتى ما يرجع صدى للباقين).

import { settings, onSetting, setSetting } from './settings.js';
import { adpcmEncode, adpcmDecode } from './adpcm.js';

export { adpcmEncode, adpcmDecode };

export const VOICE_SR = 8000;
export const FRAME = 1600; // 200ms
const HANG = 2; // نكمّل قطعتين بعد ما يسكت (حتى ما تنقطع آخر الكلمة)

const rms = (d) => {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, d.length));
};

/**
 * game: يعطينا الاتصال، اللاعبين بالمقاعد، والمرحلة.
 * الأحداث: onChange() لما تتغير حالة المايك (حتى ينرسم الزر)
 */
export class VoiceChat {
  constructor(audio, { getConn, seatUid, onChange }) {
    this.audio = audio;
    this.getConn = getConn;
    this.seatUid = seatUid;
    this.onChange = onChange || (() => {});
    this.want = settings.voiceMic !== false; // اللاعب يريد يحچي
    this.phase = 'lobby';
    this.active = false; // داخل غرفة
    this.sending = false; // يرسل هسه (للرسم)
    this.seats = new Map(); // uid → {next, gain, until, level}
    this.muted = new Set(); // لاعبين مكتومين عندي
    this.bus = null;
    this.outAn = null;
    this.frame = new Float32Array(FRAME);
    this.fill = 0;
    this.acc = 0;
    this.cnt = 0;
    this.pos = 0;
    this.noise = 0.01;
    this.hang = 0;
    this.prev = null;
    this.enc = { pred: 0, index: 0 };
    this.seq = 0;
    this.agc = 2;
    this.lastLocal = 0;
    this.tx = 0; // قطع انرسلت (للاختبار)
    this.rx = 0; // قطع انسمعت
    this.outMax = 0;
    this.k = 1.5; // نسبة الصدى: صوت المايك ÷ صوت السماعة (نبدي محتاطين)
    this.unsub = onSetting((k) => {
      if (k === 'voice') this.refresh();
    });
    // المايك انفتح/تسكّر (إذن، تسجيل، خلفية): نحدّث
    this.unmic = audio.onMic(() => this.active && this.refresh());
  }

  get enabled() {
    return settings.voice !== false;
  }

  /** المايك مسدود لوحده (وقت المثال والتسجيل) */
  get locked() {
    return this.phase === 'perform';
  }

  /** حالة الزر: off = طافي، on = شغّال، lock = مسدود وقت التقليد، need = يحتاج إذن المايك */
  get state() {
    if (!this.enabled) return 'hidden';
    if (!this.want) return 'off';
    if (this.locked) return 'lock';
    if (this.audio.micState !== 'on') return 'need';
    return 'on';
  }

  ensureBus() {
    const ctx = this.audio.ensureCtx();
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.gain.value = 1;
      this.bus.connect(this.audio.master);
      // نقيس اللي يطلع من السماعة: إذا أكو صوت، ما نرسل (المايك يلقطه ويرجع صدى للباقين)
      this.outAn = ctx.createAnalyser();
      this.outAn.fftSize = 512;
      this.audio.master.connect(this.outAn);
      this.outBuf = new Float32Array(this.outAn.fftSize);
    }
    return ctx;
  }

  start() {
    this.active = true;
    this.refresh();
  }

  stop() {
    this.active = false;
    this.audio.untap(this);
    this.audio.keepOpen = false;
    this.sending = false;
    for (const s of this.seats.values()) s.until = 0;
    if (this.bus) this.bus.gain.value = 1;
  }

  setPhase(phase) {
    if (phase === this.phase) return;
    this.phase = phase;
    // وقت التقليد: كلشي يسكت (حتى اللي بالطريق)
    if (this.bus) {
      const ctx = this.audio.ctx;
      try {
        this.bus.gain.setTargetAtTime(this.locked ? 0 : 1, ctx.currentTime, 0.04);
      } catch {
        this.bus.gain.value = this.locked ? 0 : 1;
      }
    }
    this.refresh();
  }

  /** زر المايك */
  async toggle() {
    this.want = !this.want;
    setSetting('voiceMic', this.want);
    if (this.want && this.audio.micState !== 'on' && !this.locked) {
      await this.audio.unlock();
      await this.audio.openMic();
    }
    this.refresh();
    return this.want;
  }

  refresh() {
    const live = this.active && this.enabled && this.want && !this.locked && this.audio.micState === 'on';
    this.audio.keepOpen = this.active && this.enabled && this.want;
    if (live) {
      this.ensureBus();
      this.audio.tap(this, (d) => this.onMic(d));
    } else {
      this.audio.untap(this);
      if (this.sending) this.sending = false;
      this.hang = 0;
      this.fill = 0;
    }
    this.onChange();
  }

  /** صوت السماعة هسه (0..1) */
  outLevel() {
    if (!this.outAn) return 0;
    this.outAn.getFloatTimeDomainData(this.outBuf);
    return rms(this.outBuf);
  }

  /** قطع المايك (بتردد السياق) → 8kHz → قطع 200ms */
  onMic(d) {
    // أعلى صوت طلع من السماعة خلال القطعة (للصدى)
    const o = this.outLevel();
    if (o > this.outMax) this.outMax = o;
    const ratio = this.audio.ctx.sampleRate / VOICE_SR;
    for (let i = 0; i < d.length; i++) {
      this.acc += d[i];
      this.cnt++;
      this.pos += 1;
      if (this.pos >= ratio) {
        this.pos -= ratio;
        this.frame[this.fill++] = this.acc / this.cnt;
        this.acc = 0;
        this.cnt = 0;
        if (this.fill === FRAME) {
          this.onFrame(this.frame);
          this.frame = new Float32Array(FRAME);
          this.fill = 0;
        }
      }
    }
  }

  onFrame(f) {
    const lv = rms(f);
    const out = this.outMax;
    this.outMax = 0;
    // ضوضاء الخلفية: تنزل بسرعة وتصعد على مهل
    this.noise = lv < this.noise ? lv : this.noise + (lv - this.noise) * 0.03;
    const thr = Math.max(0.012, this.noise * 3);
    // الصدى (المايك بدون إلغاء صدى): نتعلّم شكد المايك يلقط من السماعة وقت ما نحچي،
    // وما نرسل إلا إذا صوتك أعلى بوضوح من اللي يطلع من السماعة (لعبة أو ربعك)
    // (يصعد على مهل حتى أول كلامك فوق صوت اللعبة ما يتحسب صدى، وينزل وقت ما تسكت)
    if (out > 0.01 && !this.sending) {
      const r = lv / out;
      this.k = Math.max(0.1, Math.min(4, r > this.k ? Math.min(this.k * 1.05, r) : this.k + (r - this.k) * 0.1));
    }
    const echo = out * this.k * 2.5;
    const speech = lv > Math.max(thr, echo);
    if (speech) this.hang = HANG;
    else if (this.hang > 0 && lv > echo) this.hang--;
    else this.hang = 0;
    const was = this.sending;
    const send = speech || this.hang > 0;
    if (send) {
      // أول الكلام: نرسل القطعة اللي قبلها هم (حتى ما ينقص أول حرف)
      if (!was && this.prev) this.sendFrame(this.prev);
      this.sendFrame(f);
      this.lastLocal = lv;
    }
    this.prev = send ? null : f;
    this.sending = send;
    if (was !== send) this.onChange();
  }

  sendFrame(f) {
    const conn = this.getConn();
    if (!conn) return;
    // تكبير تلقائي خفيف (المايك بدون معالجة) وقص ناعم
    const lv = rms(f);
    if (lv > 0.004) this.agc += (Math.max(1, Math.min(6, 0.09 / lv)) - this.agc) * 0.3;
    const g = this.agc;
    const x = new Float32Array(f.length);
    for (let i = 0; i < f.length; i++) x[i] = Math.tanh(f[i] * g);
    const body = adpcmEncode(x, this.enc);
    const out = new Uint8Array(body.length + 2);
    out[0] = 3;
    out[1] = this.seq = (this.seq + 1) & 255;
    out.set(body, 2);
    conn.sendBinary(out);
    this.tx++;
  }

  /** صوت لاعب ثاني وصل: [seq, pred lo, pred hi, index, ...] */
  receive(seat, data) {
    if (!this.active || !this.enabled || this.locked) return;
    const uid = this.seatUid(seat);
    if (!uid || this.muted.has(uid)) return;
    const ctx = this.ensureBus();
    if (ctx.state !== 'running') return;
    const pcm = adpcmDecode(data.subarray(1));
    if (!pcm.length) return;
    let s = this.seats.get(uid);
    if (!s) {
      const gain = ctx.createGain();
      gain.connect(this.bus);
      s = { next: 0, gain, until: 0, level: 0 };
      this.seats.set(uid, s);
    }
    const buf = ctx.createBuffer(1, pcm.length, VOICE_SR);
    buf.copyToChannel(pcm, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(s.gain);
    const now = ctx.currentTime;
    // مخزن صغير ضد التقطيع: أول قطعة تتأخر شوية، وإذا تأخرنا هواية نرجع قريب
    if (s.next < now + 0.03 || s.next > now + 1.2) s.next = now + 0.16;
    try {
      src.start(s.next);
    } catch {
      return;
    }
    s.next += buf.duration;
    s.until = s.next;
    s.level = Math.min(1, rms(pcm) * 5);
    this.rx++;
  }

  /** يحچي هسه؟ (للكارت والشخصية) */
  talking(uid, me) {
    if (uid === me) return this.sending;
    const s = this.seats.get(uid);
    return !!s && s.until > this.audio.now();
  }

  level(uid, me) {
    if (uid === me) return this.sending ? Math.min(1, this.lastLocal * 6) : 0;
    const s = this.seats.get(uid);
    return s && s.until > this.audio.now() ? s.level : 0;
  }

  /** كتم/رجّع صوت لاعب عندي بس */
  toggleMute(uid) {
    if (this.muted.has(uid)) this.muted.delete(uid);
    else this.muted.add(uid);
    const s = this.seats.get(uid);
    if (s) {
      s.gain.gain.value = this.muted.has(uid) ? 0 : 1;
      if (this.muted.has(uid)) s.until = 0;
    }
    return this.muted.has(uid);
  }

  dispose() {
    this.stop();
    if (this.unsub) this.unsub();
    if (this.unmic) this.unmic();
  }
}
