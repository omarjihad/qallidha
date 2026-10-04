// مُقيّم التقليد: يقارن اللحن والإيقاع وبدايات المقاطع، ويتجاهل نبرة الصوت.
// صوت غليظ وصوت ناعم يرسمان نفس المنحنى يأخذان نفس الدرجة.
// دالة حتمية: نفس المدخل = نفس الدرجة على كل الأجهزة.

import { SR, fft, hann, median, percentile, clamp } from './dsp.js';

const HOP = 160; // 10ms
const WIN = 512; // 32ms
const YIN_W = 320; // نافذة التكامل للحدّة
const TAU_MIN = 13; // ≈1230Hz
const TAU_MAX = 230; // ≈70Hz
const MAX_FRAMES = 800; // 8 ثوانٍ كحد أقصى

const NB = WIN / 2 + 1;

/** تحليل مقطع صوتي (Float32Array على 16kHz) إلى خصائص قابلة للمقارنة. */
export function analyze(input) {
  const len = input.length;
  const nFrames = clamp(Math.floor((len - WIN) / HOP) + 1, 1, MAX_FRAMES);
  const padLen = (nFrames - 1) * HOP + WIN + TAU_MAX + YIN_W;
  let x = input;
  if (len < padLen) {
    x = new Float32Array(padLen);
    x.set(input.subarray(0, Math.min(len, padLen)));
  }

  let peakAbs = 0;
  for (let i = 0; i < len; i++) {
    const v = Math.abs(input[i]);
    if (v > peakAbs) peakAbs = v;
  }

  // 1) طاقة كل إطار
  const rms = new Float32Array(nFrames);
  let peakRms = 0;
  for (let f = 0; f < nFrames; f++) {
    const s = f * HOP;
    let acc = 0;
    for (let i = 0; i < WIN; i++) {
      const v = x[s + i];
      acc += v * v;
    }
    rms[f] = Math.sqrt(acc / WIN);
    if (rms[f] > peakRms) peakRms = rms[f];
  }
  const floor = percentile(rms, 10);
  // صوت يملأ المقطع كله يرفع "أرضية الضجيج" — لذلك نسقفها بنسبة من القمة
  const thr = Math.max(peakRms * 0.1, Math.min(floor * 2.5, peakRms * 0.3), 2e-4);
  let a = -1;
  let b = -1;
  for (let f = 0; f < nFrames; f++) {
    if (rms[f] > thr) {
      if (a < 0) a = f;
      b = f;
    }
  }
  if (a < 0 || peakRms < 1e-5) return { silent: true, n: nFrames, peakAbs };
  a = Math.max(0, a - 2);
  b = Math.min(nFrames - 1, b + 2);

  const e = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const db = 20 * Math.log10(rms[f] / peakRms + 1e-7);
    e[f] = clamp((db + 45) / 45, 0, 1);
  }

  // 2) الطيف: السطوع، التدفّق الطيفي، والنغمة العالية (صفير)
  const re = new Float64Array(WIN);
  const im = new Float64Array(WIN);
  const win = hann(WIN);
  const prev = new Float32Array(NB);
  const mag = new Float32Array(NB);
  const flux = new Float32Array(nFrames);
  const bright = new Float32Array(nFrames).fill(NaN);
  const tonal = new Float32Array(nFrames).fill(NaN);
  const magScale = 1 / (peakRms * WIN * 0.25 + 1e-9);
  const binHz = SR / WIN;
  for (let f = a; f <= b; f++) {
    const s = f * HOP;
    for (let i = 0; i < WIN; i++) {
      re[i] = x[s + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    let num = 0;
    let den = 0;
    let fl = 0;
    let pk = -1;
    let pkMag = 0;
    let bandSum = 0;
    let bandN = 0;
    for (let k = 1; k < NB; k++) {
      const m = Math.hypot(re[k], im[k]) * magScale;
      mag[k] = m;
      const hz = k * binHz;
      if (hz >= 80 && hz <= 7000) {
        num += hz * m;
        den += m;
      }
      const lm = Math.log1p(10 * m);
      const d = lm - prev[k];
      if (d > 0) fl += d;
      prev[k] = lm;
      if (hz >= 80 && hz <= 6000) {
        bandSum += m;
        bandN++;
      }
      // أقوى قمة في الطيف كله: إذا كانت عالية ونقية فهي صفير
      if (hz >= 80 && hz <= 4200 && m > pkMag) {
        pkMag = m;
        pk = k;
      }
    }
    flux[f] = f === a ? 0 : fl;
    if (den > 1e-9 && rms[f] > thr * 0.5) bright[f] = Math.log2(num / den);
    const meanBand = bandSum / Math.max(1, bandN);
    if (pk > 1 && pk < NB - 1 && pkMag > 12 * meanBand && rms[f] > thr) {
      const m0 = Math.log(mag[pk - 1] + 1e-12);
      const m1 = Math.log(mag[pk] + 1e-12);
      const m2 = Math.log(mag[pk + 1] + 1e-12);
      const dd = m0 - 2 * m1 + m2;
      const delta = Math.abs(dd) > 1e-12 ? (0.5 * (m0 - m2)) / dd : 0;
      tonal[f] = (pk + clamp(delta, -0.5, 0.5)) * binHz;
    }
  }

  // 3) الحدّة بخوارزمية YIN
  const pitch = new Float32Array(nFrames).fill(NaN);
  const dif = new Float64Array(TAU_MAX + 2);
  const cm = new Float64Array(TAU_MAX + 2);
  const off = (WIN - YIN_W) >> 1;
  for (let f = a; f <= b; f++) {
    if (rms[f] < thr * 0.7) continue;
    const s = f * HOP + off;
    for (let tau = 1; tau <= TAU_MAX + 1; tau++) {
      let acc = 0;
      for (let j = 0; j < YIN_W; j++) {
        const d = x[s + j] - x[s + j + tau];
        acc += d * d;
      }
      dif[tau] = acc;
    }
    cm[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= TAU_MAX + 1; tau++) {
      run += dif[tau];
      cm[tau] = run > 1e-12 ? (dif[tau] * tau) / run : 1;
    }
    let tau = -1;
    for (let t = TAU_MIN; t <= TAU_MAX; t++) {
      if (cm[t] < 0.15) {
        while (t + 1 <= TAU_MAX && cm[t + 1] < cm[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      let best = 1e9;
      let bt = -1;
      for (let t = TAU_MIN; t <= TAU_MAX; t++) {
        if (cm[t] < best) {
          best = cm[t];
          bt = t;
        }
      }
      if (best < 0.3) tau = bt;
    }
    if (tau > 0) {
      const y0 = cm[tau - 1];
      const y1 = cm[tau];
      const y2 = cm[tau + 1];
      const dd = y0 - 2 * y1 + y2;
      const better = Math.abs(dd) > 1e-12 ? tau + clamp((0.5 * (y0 - y2)) / dd, -0.5, 0.5) : tau;
      const f0 = SR / better;
      // صفير أعلى من مدى YIN: YIN يمسك نصف/ثلث التردد، والقمة الطيفية المهيمنة أدق
      if (!Number.isNaN(tonal[f]) && tonal[f] > 1100 && f0 < tonal[f] / 1.8) {
        pitch[f] = 69 + 12 * Math.log2(tonal[f] / 440);
      } else {
        pitch[f] = 69 + 12 * Math.log2(f0 / 440);
      }
    } else if (!Number.isNaN(tonal[f]) && tonal[f] > 250) {
      pitch[f] = 69 + 12 * Math.log2(tonal[f] / 440);
    }
  }
  cleanPitch(pitch, a, b);

  // 4) قوة البدايات ومواقعها
  let maxFlux = 1e-9;
  for (let f = a; f <= b; f++) if (flux[f] > maxFlux) maxFlux = flux[f];
  const on = new Float32Array(nFrames);
  for (let f = a; f <= b; f++) {
    const rise = f >= 2 ? Math.max(0, e[f] - e[f - 2]) : 0;
    on[f] = 0.6 * (flux[f] / maxFlux) + 0.4 * Math.min(1, rise * 3);
  }
  let mean = 0;
  let cnt = 0;
  for (let f = a; f <= b; f++) {
    mean += on[f];
    cnt++;
  }
  mean /= Math.max(1, cnt);
  let sd = 0;
  for (let f = a; f <= b; f++) sd += (on[f] - mean) ** 2;
  sd = Math.sqrt(sd / Math.max(1, cnt));
  const onsets = [a];
  for (let f = a + 1; f < b; f++) {
    if (on[f] >= on[f - 1] && on[f] > on[f + 1] && on[f] > 0.25 && on[f] > mean + sd) {
      if (f - onsets[onsets.length - 1] >= 7) onsets.push(f);
    }
  }

  let voiced = 0;
  for (let f = a; f <= b; f++) if (!Number.isNaN(pitch[f])) voiced++;

  return {
    silent: false,
    n: nFrames,
    a,
    b,
    e,
    on,
    pitch,
    bright,
    onsets,
    peakAbs,
    peakRms,
    voicedRatio: voiced / (b - a + 1),
  };
}

/** تنظيف مسار الحدّة: حذف الومضات القصيرة، تصحيح قفزات الأوكتاف، وتنعيم وسيط. */
function cleanPitch(p, a, b) {
  // ومضات أقصر من 4 إطارات
  let f = a;
  while (f <= b) {
    if (Number.isNaN(p[f])) {
      f++;
      continue;
    }
    let g = f;
    while (g + 1 <= b && !Number.isNaN(p[g + 1])) g++;
    if (g - f + 1 < 4) for (let k = f; k <= g; k++) p[k] = NaN;
    f = g + 1;
  }
  // قفزات الأوكتاف داخل المقطع الواحد
  const tmp = new Float32Array(p);
  for (let k = a; k <= b; k++) {
    if (Number.isNaN(tmp[k])) continue;
    const win = [];
    for (let j = k - 4; j <= k + 4; j++) if (j >= a && j <= b && !Number.isNaN(tmp[j])) win.push(tmp[j]);
    const m = median(win);
    const d = tmp[k] - m;
    if (Math.abs(Math.abs(d) - 12) < 2.5) p[k] = tmp[k] - 12 * Math.sign(d);
  }
  // تنعيم وسيط بطول 5
  const src = new Float32Array(p);
  for (let k = a; k <= b; k++) {
    if (Number.isNaN(src[k])) continue;
    const win = [];
    for (let j = k - 2; j <= k + 2; j++) if (j >= a && j <= b && !Number.isNaN(src[j])) win.push(src[j]);
    p[k] = median(win);
  }
}

function octDist(x) {
  return Math.abs(x - 12 * Math.round(x / 12));
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return NaN;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx < 1e-9 || syy < 1e-9) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

function relative(arr, a, b) {
  const vals = [];
  for (let f = a; f <= b; f++) if (!Number.isNaN(arr[f])) vals.push(arr[f]);
  const m = vals.length ? median(vals) : 0;
  const out = new Float32Array(b - a + 1);
  for (let f = a; f <= b; f++) out[f - a] = Number.isNaN(arr[f]) ? NaN : arr[f] - m;
  return out;
}

function stretch(src, a, b, n) {
  const out = new Float32Array(n);
  const len = b - a + 1;
  for (let i = 0; i < n; i++) {
    const pos = n > 1 ? (i * (len - 1)) / (n - 1) : 0;
    const k = Math.floor(pos);
    const fr = pos - k;
    const v0 = src[a + k];
    const v1 = src[a + Math.min(len - 1, k + 1)];
    out[i] = v0 + (v1 - v0) * fr;
  }
  return out;
}

function smooth3(arr) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const l = arr[Math.max(0, i - 1)];
    const r = arr[Math.min(arr.length - 1, i + 1)];
    out[i] = (l + 2 * arr[i] + r) / 4;
  }
  return out;
}

/** معايرة الدرجة النهائية: الخام 0..1 إلى 0..100. */
const RAW_FLOOR = 0.5;
const RAW_CEIL = 0.95;
const GAMMA = 1.25;

/**
 * يقارن تقليد اللاعب (take) بالصوت الأصلي (ref). كلاهما ناتج analyze().
 * يعيد { score: 0..100, parts }.
 */
export function compare(R, T) {
  const zero = (reason) => ({ score: 0, reason, parts: {} });
  if (!R || R.silent) return zero('no-ref');
  if (!T || T.silent || T.peakAbs < 0.006) return zero('silent');
  const Nr = R.b - R.a + 1;
  const Nt = T.b - T.a + 1;
  if (Nt < 8) return zero('short');

  // خصائص نسبية: الحدّة والسطوع منسوبان لوسيط كل مقطع
  const pr = relative(R.pitch, R.a, R.b);
  const pt = relative(T.pitch, T.a, T.b);
  const br = relative(R.bright, R.a, R.b);
  const bt = relative(T.bright, T.a, T.b);

  // ---- محاذاة زمنية مرنة (DTW) ضمن نطاق
  const band = Math.max(8, Math.round(0.22 * Math.max(Nr, Nt)));
  const INF = 1e30;
  const D = new Float32Array(Nr * Nt).fill(INF);
  const step = new Uint8Array(Nr * Nt);
  const cost = (i, j) => {
    const fi = R.a + i;
    const fj = T.a + j;
    let c = Math.abs(R.e[fi] - T.e[fj]) + 0.6 * Math.abs(R.on[fi] - T.on[fj]);
    const vr = Number.isNaN(pr[i]) ? 0 : 1;
    const vt = Number.isNaN(pt[j]) ? 0 : 1;
    c += 0.35 * Math.abs(vr - vt);
    if (vr && vt) c += 0.25 * Math.min(1, octDist(pr[i] - pt[j]) / 6);
    if (!Number.isNaN(br[i]) && !Number.isNaN(bt[j])) c += 0.3 * Math.min(1, Math.abs(br[i] - bt[j]));
    else c += 0.15;
    return c;
  };
  const PEN = 0.06;
  for (let i = 0; i < Nr; i++) {
    const center = Nr > 1 ? (i * (Nt - 1)) / (Nr - 1) : 0;
    const j0 = Math.max(0, Math.floor(center - band));
    const j1 = Math.min(Nt - 1, Math.ceil(center + band));
    for (let j = j0; j <= j1; j++) {
      const c = cost(i, j);
      const idx = i * Nt + j;
      if (i === 0 && j === 0) {
        D[idx] = c;
        continue;
      }
      let best = INF;
      let s = 0;
      if (i > 0 && j > 0 && D[idx - Nt - 1] < best) {
        best = D[idx - Nt - 1];
        s = 1;
      }
      if (i > 0 && D[idx - Nt] + PEN < best) {
        best = D[idx - Nt] + PEN;
        s = 2;
      }
      if (j > 0 && D[idx - 1] + PEN < best) {
        best = D[idx - 1] + PEN;
        s = 3;
      }
      if (best < INF) {
        D[idx] = best + c;
        step[idx] = s;
      }
    }
  }
  const pathI = [];
  const pathJ = [];
  {
    let i = Nr - 1;
    let j = Nt - 1;
    let guard = Nr + Nt + 5;
    while (guard-- > 0) {
      pathI.push(i);
      pathJ.push(j);
      if (i === 0 && j === 0) break;
      const s = step[i * Nt + j];
      if (s === 1) {
        i--;
        j--;
      } else if (s === 2) i--;
      else if (s === 3) j--;
      else break;
    }
    pathI.reverse();
    pathJ.reverse();
  }

  // ---- اللحن (الحدّة) مع أفضل نقل للمقام
  const diffs = [];
  for (let k = 0; k < pathI.length; k++) {
    const x = pr[pathI[k]];
    const y = pt[pathJ[k]];
    if (!Number.isNaN(x) && !Number.isNaN(y)) diffs.push(y - x);
  }
  let shift = 0;
  if (diffs.length) {
    let bestC = Infinity;
    const scan = (from, to, st) => {
      for (let s = from; s <= to + 1e-9; s += st) {
        let c = 0;
        for (const d of diffs) c += Math.min(octDist(d - s), 6);
        if (c < bestC) {
          bestC = c;
          shift = s;
        }
      }
    };
    scan(-6, 6, 0.5);
    const c0 = shift;
    scan(c0 - 0.5, c0 + 0.5, 0.1);
  }
  const SIG = 2.0;
  const perRef = new Map();
  for (let k = 0; k < pathI.length; k++) {
    const i = pathI[k];
    if (Number.isNaN(pr[i])) continue;
    const y = pt[pathJ[k]];
    const m = Number.isNaN(y) ? 0 : Math.exp(-((octDist(y - pr[i] - shift) / SIG) ** 2));
    const cur = perRef.get(i);
    if (cur) {
      cur.s += m;
      cur.n++;
    } else perRef.set(i, { s: m, n: 1 });
  }
  let melodyAcc = 0;
  for (const v of perRef.values()) melodyAcc += v.s / v.n;
  melodyAcc = perRef.size ? melodyAcc / perRef.size : 0;

  const xs = [];
  const ys = [];
  for (let k = 0; k < pathI.length; k++) {
    const x = pr[pathI[k]];
    const y = pt[pathJ[k]];
    if (!Number.isNaN(x) && !Number.isNaN(y)) {
      xs.push(x);
      ys.push(y - shift - 12 * Math.round((y - shift - x) / 12));
    }
  }
  let refStd = 0;
  {
    const v = [];
    for (let i = 0; i < Nr; i++) if (!Number.isNaN(pr[i])) v.push(pr[i]);
    if (v.length > 2) {
      const m = v.reduce((s, q) => s + q, 0) / v.length;
      refStd = Math.sqrt(v.reduce((s, q) => s + (q - m) ** 2, 0) / v.length);
    }
  }
  const corr = refStd >= 1 && xs.length >= 10 ? pearson(xs, ys) : NaN;
  const melody = Number.isNaN(corr) ? melodyAcc : 0.75 * melodyAcc + 0.25 * Math.max(0, corr);

  // ---- السطوع (للأصوات غير النغمية)
  let bs = 0;
  let bn = 0;
  for (let k = 0; k < pathI.length; k++) {
    const x = br[pathI[k]];
    const y = bt[pathJ[k]];
    if (Number.isNaN(x)) continue;
    bn++;
    if (!Number.isNaN(y)) bs += Math.exp(-(((x - y) / 0.7) ** 2));
  }
  const bright = bn ? bs / bn : 0;

  // ---- توافق التصويت والطاقة على المسار
  let agree = 0;
  const er = [];
  const et = [];
  for (let k = 0; k < pathI.length; k++) {
    const i = pathI[k];
    const j = pathJ[k];
    const vr = !Number.isNaN(pr[i]);
    const vt = !Number.isNaN(pt[j]);
    if (vr === vt) agree++;
    er.push(R.e[R.a + i]);
    et.push(T.e[T.a + j]);
  }
  const voice = agree / Math.max(1, pathI.length);
  const envCorr = pearson(er, et);
  const env = Number.isNaN(envCorr) ? 0.5 : Math.max(0, envCorr);

  // ---- الإيقاع بلا ليّ: مطّ منتظم ثم أفضل إزاحة صغيرة
  const reE = stretch(R.e, R.a, R.b, Nr);
  const reO = smooth3(stretch(R.on, R.a, R.b, Nr));
  const teE = stretch(T.e, T.a, T.b, Nr);
  const teO = smooth3(stretch(T.on, T.a, T.b, Nr));
  const maxShift = Math.max(2, Math.round(Nr * 0.08));
  let rhythm = 0;
  for (let sh = -maxShift; sh <= maxShift; sh++) {
    const ax = [];
    const ay = [];
    const ox = [];
    const oy = [];
    for (let i = 0; i < Nr; i++) {
      const j = i + sh;
      if (j < 0 || j >= Nr) continue;
      ax.push(reE[i]);
      ay.push(teE[j]);
      ox.push(reO[i]);
      oy.push(teO[j]);
    }
    const c1 = pearson(ax, ay);
    const c2 = pearson(ox, oy);
    const v = 0.6 * (Number.isNaN(c1) ? 0.5 : c1) + 0.4 * (Number.isNaN(c2) ? 0.3 : c2);
    if (v > rhythm) rhythm = v;
  }
  rhythm = clamp(rhythm, 0, 1);

  // ---- البدايات (attacks)
  const ro = R.onsets.map((f) => f - R.a);
  const to = T.onsets.map((f) => ((f - T.a) * (Nr - 1)) / Math.max(1, Nt - 1));
  let attack;
  if (ro.length <= 1 && to.length <= 1) attack = 1;
  else if (ro.length <= 1) attack = 1 / (1 + 0.35 * (to.length - 1));
  else {
    const used = new Uint8Array(to.length);
    let hit = 0;
    for (const r of ro) {
      let bi = -1;
      let bd = 8;
      for (let k = 0; k < to.length; k++) {
        if (used[k]) continue;
        const d = Math.abs(to[k] - r);
        if (d <= bd) {
          bd = d;
          bi = k;
        }
      }
      if (bi >= 0) {
        used[bi] = 1;
        hit++;
      }
    }
    const P = hit / Math.max(1, to.length);
    const Rc = hit / ro.length;
    attack = P + Rc > 0 ? (2 * P * Rc) / (P + Rc) : 0;
  }

  // ---- المدة
  const ratio = Nt / Nr;
  const dur = Math.exp(-((Math.log(ratio) / 0.5) ** 2));

  // ---- الدمج
  const vr = R.voicedRatio;
  let tonalScore;
  if (vr >= 0.5) tonalScore = melody;
  else if (vr <= 0.15) tonalScore = bright;
  else {
    const w = (vr - 0.15) / 0.35;
    tonalScore = w * melody + (1 - w) * bright;
  }
  const raw =
    0.55 * tonalScore + 0.17 * rhythm + 0.1 * attack + 0.08 * dur + 0.05 * voice + 0.05 * env;
  let score = 100 * Math.pow(clamp((raw - RAW_FLOOR) / (RAW_CEIL - RAW_FLOOR), 0, 1), GAMMA);
  // اللحن هو الأساس: بلا لحن قريب لا درجة عالية مهما كان الإيقاع
  if (vr >= 0.4 && melody < 0.25) score = Math.min(score, 30 + 60 * melody);
  score = Math.round(clamp(score, 0, 100));

  return {
    score,
    parts: {
      raw: +raw.toFixed(3),
      tonal: +tonalScore.toFixed(3),
      melody: +melody.toFixed(3),
      bright: +bright.toFixed(3),
      rhythm: +rhythm.toFixed(3),
      attack: +attack.toFixed(3),
      dur: +dur.toFixed(3),
      voice: +voice.toFixed(3),
      env: +env.toFixed(3),
      shift: +shift.toFixed(1),
    },
  };
}

/** اختصار: درجة مباشرة من عيّنتين. */
export function scorePcm(refPcm, takePcm) {
  return compare(analyze(refPcm), analyze(takePcm));
}
