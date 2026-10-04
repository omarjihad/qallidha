// أدوات معالجة الصوت المشتركة — تعمل في المتصفح وفي Node بلا أي اعتماد خارجي.

export const SR = 16000; // كل التحليل والإرسال على 16 كيلوهرتز أحادي

/* ------------------------------------------------------------ FFT */
const fftCache = new Map();

function fftTables(n) {
  let t = fftCache.get(n);
  if (t) return t;
  const levels = Math.log2(n) | 0;
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0, v = i; b < levels; b++, v >>= 1) r = (r << 1) | (v & 1);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  t = { rev, cos, sin };
  fftCache.set(n, t);
  return t;
}

/** FFT مركّب في المكان. re/im بطول قوة 2. */
export function fft(re, im) {
  const n = re.length;
  const { rev, cos, sin } = fftTables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + half; j++, k += step) {
        const l = j + half;
        const tre = re[l] * cos[k] + im[l] * sin[k];
        const tim = -re[l] * sin[k] + im[l] * cos[k];
        re[l] = re[j] - tre;
        im[l] = im[j] - tim;
        re[j] += tre;
        im[j] += tim;
      }
    }
  }
}

const hannCache = new Map();
export function hann(n) {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hannCache.set(n, w);
  }
  return w;
}

/* ------------------------------------------------------------ إعادة التقطيع */
/**
 * تحويل أي معدل عيّنات إلى معدل آخر بنواة sinc مُنوّفة (تمنع التشوّه عند التخفيض).
 */
const PHASES = 512;
const kernelCache = new Map();

function resampleKernel(fromRate, toRate) {
  const key = fromRate + ':' + toRate;
  let k = kernelCache.get(key);
  if (k) return k;
  const cutoff = Math.min(1, toRate / fromRate) * 0.92; // نسبةً لنايكوست المصدر
  const half = Math.ceil(8 / cutoff); // عرض النواة بعيّنات المصدر
  const taps = 2 * half;
  const table = new Float32Array((PHASES + 1) * taps);
  for (let p = 0; p <= PHASES; p++) {
    const frac = p / PHASES;
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const d = frac + half - 1 - j;
      const x = Math.PI * d * cutoff;
      const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
      const win = Math.abs(d) >= half ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / half);
      const w = sinc * win;
      table[p * taps + j] = w;
      sum += w;
    }
    for (let j = 0; j < taps; j++) table[p * taps + j] /= sum || 1;
  }
  k = { half, taps, table };
  kernelCache.set(key, k);
  return k;
}

/**
 * تحويل أي معدل عيّنات إلى معدل آخر بنواة sinc مُنوّفة (تمنع التشوّه عند التخفيض).
 * النواة محسوبة مسبقًا لـ512 طورًا فلا توجد دوال مثلثية داخل الحلقة.
 */
export function resample(input, fromRate, toRate = SR) {
  if (fromRate === toRate) return Float32Array.from(input);
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  const { half, taps, table } = resampleKernel(fromRate, toRate);
  const n = input.length;
  for (let i = 0; i < outLen; i++) {
    const center = i * ratio;
    const base = Math.floor(center);
    const p = Math.round((center - base) * PHASES);
    const row = p * taps;
    const start = base - half + 1;
    let acc = 0;
    if (start >= 0 && start + taps <= n) {
      for (let j = 0; j < taps; j++) acc += input[start + j] * table[row + j];
    } else {
      for (let j = 0; j < taps; j++) {
        const k = start + j;
        if (k >= 0 && k < n) acc += input[k] * table[row + j];
      }
    }
    out[i] = acc;
  }
  return out;
}

/** خلط القنوات إلى أحادي. */
export function toMono(channels) {
  if (channels.length === 1) return Float32Array.from(channels[0]);
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  for (let i = 0; i < n; i++) out[i] /= channels.length;
  return out;
}

/* ------------------------------------------------------------ μ-law (G.711) */
const BIAS = 0x84;
const CLIP = 32635;

export function mulawEncode(f32) {
  const out = new Uint8Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    let s = Math.max(-1, Math.min(1, f32[i])) * 32767;
    let sign = 0;
    if (s < 0) { sign = 0x80; s = -s; }
    if (s > CLIP) s = CLIP;
    s = (s | 0) + BIAS;
    let exp = 7;
    for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1);
    const mant = (s >> (exp + 3)) & 0x0f;
    out[i] = ~(sign | (exp << 4) | mant) & 0xff;
  }
  return out;
}

const MULAW_TABLE = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff;
    const sign = u & 0x80;
    const exp = (u >> 4) & 0x07;
    const mant = u & 0x0f;
    let s = ((mant << 3) + BIAS) << exp;
    s -= BIAS;
    t[i] = (sign ? -s : s) / 32768;
  }
  return t;
})();

export function mulawDecode(u8) {
  const out = new Float32Array(u8.length);
  for (let i = 0; i < u8.length; i++) out[i] = MULAW_TABLE[u8[i]];
  return out;
}

/* ------------------------------------------------------------ متفرقات */
export function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

export function normalize(x, target = 0.9) {
  const p = peakOf(x);
  if (p < 1e-6) return Float32Array.from(x);
  const g = target / p;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * g;
  return out;
}

/** قمم للرسم: مصفوفة بطول bars فيها أقصى قيمة مطلقة لكل شريحة (0..1). */
export function peaks(x, bars = 160) {
  const out = new Float32Array(bars);
  if (!x || !x.length) return out;
  const step = x.length / bars;
  let max = 1e-9;
  for (let b = 0; b < bars; b++) {
    const s = Math.floor(b * step);
    const e = Math.min(x.length, Math.floor((b + 1) * step));
    let p = 0;
    for (let i = s; i < e; i++) {
      const a = Math.abs(x[i]);
      if (a > p) p = a;
    }
    out[b] = p;
    if (p > max) max = p;
  }
  for (let b = 0; b < bars; b++) out[b] = Math.min(1, out[b] / max);
  return out;
}

/** مولّد أرقام عشوائية ثابت البذرة: نفس البذرة = نفس الناتج على كل الأجهزة. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function median(arr) {
  if (!arr.length) return NaN;
  const a = Array.from(arr).sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function percentile(arr, p) {
  if (!arr.length) return NaN;
  const a = Array.from(arr).sort((x, y) => x - y);
  const idx = Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))));
  return a[idx];
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
