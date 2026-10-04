// محرك الصوت: فك ترميز الأصوات، التشغيل المتزامن، المايك والتسجيل بنافذة زمنية دقيقة، ومؤثرات الواجهة.

import { SR, resample, toMono, peaks, peakOf } from './dsp.js';
import { MAX_REC } from './shared.js';

const WORKLET_SRC = `
class QdRec extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.buf = new Float32Array(2048);
    this.n = 0;
    this.t0 = 0;
    this.port.onmessage = (e) => { this.on = !!e.data.on; if (!this.on && this.n) { this.flush(); } this.n = 0; };
  }
  flush() { this.port.postMessage({ t: this.t0, d: this.buf.slice(0, this.n) }); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || !this.on) return true;
    if (this.n === 0) this.t0 = currentTime;
    if (this.n + ch.length > this.buf.length) { this.flush(); this.t0 = currentTime; }
    this.buf.set(ch, this.n);
    this.n += ch.length;
    return true;
  }
}
registerProcessor('qd-rec', QdRec);
`;

let oggDecoderPromise = null;
function loadOggDecoder() {
  if (!oggDecoderPromise) {
    oggDecoderPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/ogg-opus-decoder.min.js';
      s.charset = 'UTF-8';
      s.onload = () => resolve(window['ogg-opus-decoder']);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return oggDecoderPromise;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.stream = null;
    this.micSrc = null;
    this.recNode = null;
    this.sink = null;
    this.chunks = [];
    this.armed = false;
    this.micState = 'off'; // off | asking | on | denied | error
    this.onChunk = null;
    this.cache = new Map();
    this.sfxBufs = null;
    this.muted = false;
  }

  ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** يُستدعى داخل لمسة المستخدم: يفتح الصوت على iOS/أندرويد. */
  async unlock() {
    this.ensureCtx();
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* */
      }
    }
    try {
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.master);
      s.start(0);
    } catch {
      /* */
    }
    return this.ctx.state === 'running';
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /* ------------------------------------------------------------ تحميل الأصوات */

  async decodeBytes(bytes) {
    const ctx = this.ensureCtx();
    try {
      return await new Promise((resolve, reject) => {
        const p = ctx.decodeAudioData(bytes.slice(0).buffer, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
    } catch (e) {
      // OggS = فويس تيليجرام: نفكّه بمفكك WebAssembly (لأجهزة iOS القديمة)
      if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
        const lib = await loadOggDecoder();
        const dec = new lib.OggOpusDecoder();
        await dec.ready;
        const r = await dec.decodeFile(bytes);
        dec.free();
        const ch = r.channelData;
        const buf = ctx.createBuffer(ch.length, r.samplesDecoded, r.sampleRate);
        ch.forEach((d, i) => buf.copyToChannel(d.subarray(0, r.samplesDecoded), i));
        return buf;
      }
      throw e;
    }
  }

  /** يحمّل صوتًا ويجهّزه: نسخة للتشغيل، نسخة 16kHz للتحليل، وقمم للرسم. */
  load(url, { video = false } = {}) {
    if (this.cache.has(url)) return this.cache.get(url);
    const p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('تعذّر تحميل الصوت');
      const bytes = new Uint8Array(await res.arrayBuffer());
      const buffer = await this.decodeBytes(bytes);
      const chans = [];
      for (let i = 0; i < buffer.numberOfChannels; i++) chans.push(buffer.getChannelData(i));
      const mono = toMono(chans);
      // قص الصمت من البداية والنهاية + حد أقصى 7 ثوانٍ
      const pk = peakOf(mono) || 1;
      const thr = pk * 0.02;
      let s = 0;
      while (s < mono.length && Math.abs(mono[s]) < thr) s++;
      let e = mono.length - 1;
      while (e > s && Math.abs(mono[e]) < thr) e--;
      s = Math.max(0, s - Math.floor(0.02 * buffer.sampleRate));
      e = Math.min(mono.length, e + Math.floor(0.05 * buffer.sampleRate));
      e = Math.min(e, s + Math.floor(MAX_REC * buffer.sampleRate));
      const trimmed = mono.subarray(s, e);
      const play = this.ctx.createBuffer(1, Math.max(1, trimmed.length), buffer.sampleRate);
      play.copyToChannel(Float32Array.from(trimmed), 0);
      const pcm = resample(trimmed, buffer.sampleRate, SR);
      const entry = {
        url,
        buffer: play,
        pcm,
        dur: trimmed.length / buffer.sampleRate,
        offset: s / buffer.sampleRate,
        peaks: peaks(pcm, 200),
        videoUrl: video ? URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' })) : null,
      };
      return entry;
    })();
    this.cache.set(url, p);
    p.catch(() => this.cache.delete(url));
    return p;
  }

  /* ------------------------------------------------------------ التشغيل */

  /**
   * يشغّل AudioBuffer. when = وقت سياق (ثواني) للتشغيل المتزامن، أو null = هسه.
   * إذا الوقت فات (اتصال متأخر) يبدي من النقطة اللي وصلها الكل بدل ما يبدي من الأول.
   */
  play(buffer, when = null, { gain = 1, analyse = false } = {}) {
    const ctx = this.ensureCtx();
    // بعد إطفاء المايك بعض الأجهزة توكّف السياق: نرجّعه (ينجح لأن المستخدم لمس الشاشة قبل)
    if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => null);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = this.muted ? 0 : gain;
    src.connect(g);
    let analyser = null;
    if (analyse) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      g.connect(analyser);
    }
    g.connect(this.master);
    const now = ctx.currentTime;
    let startAt = now;
    let offset = 0;
    if (when !== null && when !== undefined && Number.isFinite(when)) {
      if (when >= now) startAt = when;
      else offset = Math.min(now - when, Math.max(0, buffer.duration - 0.02));
    }
    try {
      src.start(startAt, offset);
    } catch {
      src.start();
    }
    return { source: src, analyser, gainNode: g };
  }

  pcmBuffer(pcm) {
    const ctx = this.ensureCtx();
    const b = ctx.createBuffer(1, Math.max(1, pcm.length), SR);
    b.copyToChannel(pcm, 0);
    return b;
  }

  static level(analyser) {
    if (!analyser) return 0;
    const d = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(d);
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    return Math.min(1, Math.sqrt(s / d.length) * 4);
  }

  /* ------------------------------------------------------------ المايك */

  async openMic() {
    if (this.micState === 'on' && this.stream && this.stream.active) return true;
    this.ensureCtx();
    this.micState = 'asking';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      this.micState = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'error';
      return false;
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* */
      }
    }
    this.micSrc = this.ctx.createMediaStreamSource(this.stream);
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(this.ctx.destination);
    let ok = false;
    if (this.ctx.audioWorklet && window.AudioWorkletNode) {
      try {
        if (!this.workletLoaded) {
          const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
          await this.ctx.audioWorklet.addModule(url);
          this.workletLoaded = true;
        }
        this.recNode = new AudioWorkletNode(this.ctx, 'qd-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        this.recNode.port.onmessage = (e) => this.pushChunk(e.data.t, e.data.d);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      const sp = this.ctx.createScriptProcessor(2048, 1, 1);
      sp.onaudioprocess = (e) => {
        if (!this.armed) return;
        const d = e.inputBuffer.getChannelData(0);
        const t = (e.playbackTime || this.ctx.currentTime) - (2 * 2048) / this.ctx.sampleRate;
        this.pushChunk(t, Float32Array.from(d));
      };
      this.recNode = sp;
    }
    this.micSrc.connect(this.recNode);
    this.recNode.connect(this.sink);
    this.micState = 'on';
    return true;
  }

  closeMic() {
    try {
      this.recNode && this.recNode.disconnect();
      this.micSrc && this.micSrc.disconnect();
      this.sink && this.sink.disconnect();
    } catch {
      /* */
    }
    if (this.stream) for (const tr of this.stream.getTracks()) tr.stop();
    this.stream = null;
    this.recNode = null;
    this.micSrc = null;
    if (this.micState === 'on') this.micState = 'off';
  }

  /**
   * نطفي المايك بعد كل تسجيل (iOS وأندرويد): المايك المفتوح يحوّل الصوت لوضع المكالمة
   * فيطلع التشغيل واطي أو من سماعة الأذن. ينفتح من جديد قبل التسجيل الجاي تلقائيًا.
   */
  get releaseAfterRecord() {
    return true;
  }

  pushChunk(t, d) {
    if (!this.armed) return;
    this.chunks.push({ t, d });
    if (this.onChunk) this.onChunk(t, d);
  }

  arm() {
    this.chunks = [];
    this.armed = true;
    if (this.recNode && this.recNode.port) this.recNode.port.postMessage({ on: true });
  }

  disarm() {
    this.armed = false;
    if (this.recNode && this.recNode.port) this.recNode.port.postMessage({ on: false });
  }

  /** يقص نافذة زمنية [start, end] (وقت السياق) من التسجيل ويحوّلها لـ16kHz. */
  extract(start, end) {
    const sr = this.ctx.sampleRate;
    const n = Math.max(1, Math.round((end - start) * sr));
    const out = new Float32Array(n);
    for (const { t, d } of this.chunks) {
      const off = Math.round((t - start) * sr);
      for (let i = 0; i < d.length; i++) {
        const k = off + i;
        if (k >= 0 && k < n) out[k] = d[i];
      }
    }
    return resample(out, sr, SR);
  }

  /* ------------------------------------------------------------ مؤثرات الواجهة */

  buildSfx() {
    const ctx = this.ensureCtx();
    const sr = ctx.sampleRate;
    const make = (dur, fn) => {
      const n = Math.floor(dur * sr);
      const b = ctx.createBuffer(1, n, sr);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = fn(i / sr, i, n);
      return b;
    };
    const tone = (f, t, dur, decay = 18) => Math.sin(2 * Math.PI * f * t) * Math.exp(-t * decay) * Math.min(1, (dur - t) / 0.01);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    this.sfxBufs = {
      tick: make(0.09, (t, i, n) => 0.5 * tone(1046, t, 0.09, 30)),
      go: make(0.3, (t) => 0.45 * Math.sin(2 * Math.PI * (600 * t + 1500 * t * t)) * Math.exp(-t * 6)),
      pop: make(0.08, (t) => 0.4 * rnd() * Math.exp(-t * 60)),
      click: make(0.02, (t) => 0.35 * rnd() * Math.exp(-t * 300)),
      ding: make(0.6, (t) => 0.35 * (tone(1568, t, 0.6, 5) + (t > 0.09 ? tone(2093, t - 0.09, 0.51, 5) : 0))),
      sab: make(0.6, (t) => 0.4 * Math.sign(Math.sin(2 * Math.PI * (260 - 220 * t) * t)) * Math.exp(-t * 4)),
      win: make(1.0, (t) => {
        const notes = [523, 659, 784, 1046];
        let s = 0;
        notes.forEach((f, k) => {
          const st = k * 0.12;
          if (t > st) s += tone(f, t - st, 1 - st, 4) * 0.25;
        });
        return s;
      }),
      whoosh: make(0.45, (t, i, n) => 0.25 * rnd() * Math.sin((Math.PI * i) / n)),
    };
  }

  sfx(name, gain = 1) {
    if (!this.running || this.muted) return;
    if (!this.sfxBufs) this.buildSfx();
    const b = this.sfxBufs[name];
    if (b) this.play(b, null, { gain: 0.7 * gain });
  }
}
