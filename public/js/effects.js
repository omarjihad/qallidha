// تخريبات العجلة — معالجة حتمية على عيّنات 16kHz.
// حتمية لأن كل جهاز يقيّم كل التسجيلات، فلازم الكل يسمع ويحسب نفس الشي.

import { SR, mulberry32, normalize } from './dsp.js';

export const SABOTAGE_ORDER = ['crap', 'chip', 'chop', 'dist', 'echo'];

/** صوت ضرطة مركّب من بذرة ثابتة. */
export function fart(seed, seconds) {
  const rand = mulberry32(seed || 1);
  const dur = Math.max(0.7, Math.min(4, seconds));
  const n = Math.floor(dur * SR);
  const out = new Float32Array(n);
  const base = 62 + rand() * 38;
  const wob = 2.5 + rand() * 3;
  const sput = 7 + rand() * 6;
  let phase = 0;
  let lp = 0;
  let drift = 0;
  const lpA = Math.exp((-2 * Math.PI * 900) / SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    drift += (rand() - 0.5) * 0.004;
    drift *= 0.999;
    const f0 = base * (1 + 0.22 * Math.sin(2 * Math.PI * wob * t) + drift * 6) * (1 - 0.25 * (t / dur));
    phase += Math.max(20, f0) / SR;
    if (phase >= 1) phase -= 1;
    const pulse = phase < 0.16 ? 1 : -0.19;
    const noise = (rand() * 2 - 1) * 0.45;
    const raw = pulse + noise * (0.4 + 0.6 * (phase < 0.3 ? 1 : 0));
    lp = (1 - lpA) * raw + lpA * lp;
    const att = Math.min(1, t / 0.03);
    const rel = Math.min(1, (dur - t) / 0.18);
    const s = 0.65 + 0.35 * Math.sin(2 * Math.PI * sput * t + Math.sin(t * 3));
    out[i] = lp * att * rel * s;
  }
  return normalize(out, 0.9);
}

function chipmunk(x, factor = 1.6) {
  const n = Math.floor(x.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * factor;
    const k = Math.floor(p);
    const fr = p - k;
    const a = x[k] || 0;
    const b = x[k + 1] || 0;
    out[i] = a + (b - a) * fr;
  }
  return out;
}

function chop(x) {
  const on = Math.floor(0.11 * SR);
  const off = Math.floor(0.075 * SR);
  const ramp = Math.floor(0.005 * SR);
  const per = on + off;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const p = i % per;
    let g;
    if (p < on) g = Math.min(1, p / ramp, (on - p) / ramp);
    else g = 0;
    out[i] = x[i] * g;
  }
  return out;
}

function distort(x, seed) {
  const rand = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const out = new Float32Array(x.length);
  let hold = 0;
  let crackle = 0;
  for (let i = 0; i < x.length; i++) {
    if (i % 4 === 0) {
      const v = Math.tanh(x[i] * 16) * 0.8;
      hold = Math.round(v * 3) / 3;
    }
    if (rand() < 0.002) crackle = 1;
    crackle *= 0.995;
    out[i] = hold + (rand() * 2 - 1) * 0.35 * crackle + (rand() * 2 - 1) * 0.04;
  }
  return out;
}

function echo(x) {
  const delay = Math.floor(0.23 * SR);
  const tail = Math.floor(0.8 * SR);
  const out = new Float32Array(x.length + tail);
  out.set(x);
  for (let i = delay; i < out.length; i++) out[i] += out[i - delay] * 0.55;
  return out;
}

/**
 * يطبّق قائمة التخريبات على تسجيل.
 * seed يجب أن يكون نفسه على كل الأجهزة (مثلًا: hash(رقم الجولة + معرّف اللاعب)).
 */
export function applySabotage(pcm, types, seed) {
  if (!types || !types.length) return pcm;
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  // تسجيل صامت يبقى صامتًا (إلا الضرطة: هذي تُسمع بكل الأحوال)
  if (peak < 0.006 && !types.includes('crap')) return pcm;
  let x = pcm;
  const set = new Set(types);
  for (const t of SABOTAGE_ORDER) {
    if (!set.has(t)) continue;
    if (t === 'crap') x = fart(seed, x.length / SR);
    else if (t === 'chip') x = chipmunk(x);
    else if (t === 'chop') x = chop(x);
    else if (t === 'dist') x = distort(x, seed);
    else if (t === 'echo') x = echo(x);
  }
  return normalize(x, 0.9);
}
