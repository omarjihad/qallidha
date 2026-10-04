// معايرة واختبار المُقيّم على الأصوات المدمجة وتقليدات مركّبة.
// التشغيل: node tools/test-scorer.mjs [--verbose]
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SR, mulberry32, mulawEncode, mulawDecode, resample } from '../public/js/dsp.js';
import { analyze, compare } from '../public/js/scorer.js';
import { applySabotage, fart } from '../public/js/effects.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERBOSE = process.argv.includes('--verbose');
const RAWDUMP = process.argv.includes('--raw');
const rawGroups = {};

function decode(file, af = '') {
  const args = ['-v', 'error', '-i', file];
  if (af) args.push('-af', af);
  args.push('-f', 'f32le', '-ac', '1', '-ar', String(SR), '-');
  const r = spawnSync('ffmpeg', args, { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/** تقليد بشري مركّب: يتبع منحنى الحدّة والطاقة للأصل بصوت حنجري مختلف تمامًا. */
function imitate(ref, opts = {}) {
  const { transpose = -5, err = 0.7, warp = 0.1, vowel = 'u', seed = 1, lag = 0.12, gain = 0.5 } = opts;
  const F = analyze(ref);
  const rand = mulberry32(seed);
  const FORM = {
    u: [[320, 80, 1], [870, 110, 0.5], [2240, 200, 0.2]],
    a: [[730, 90, 1], [1090, 110, 0.6], [2440, 200, 0.25]],
    i: [[280, 70, 1], [2250, 150, 0.5], [2900, 220, 0.25]],
  }[vowel];
  const nf = F.b - F.a + 1;
  // ليّ زمني ناعم
  const knots = 6;
  const kv = Array.from({ length: knots }, () => 1 + (rand() * 2 - 1) * warp);
  const rate = (u) => {
    const p = u * (knots - 1);
    const k = Math.min(knots - 2, Math.floor(p));
    return kv[k] + (kv[k + 1] - kv[k]) * (p - k);
  };
  const outLen = Math.floor((nf * 160 * (1 + warp)) + SR * (lag + 0.3));
  const out = new Float32Array(outLen);
  let pos = 0; // موقع بإطارات الأصل
  let phase = 0;
  let walk = 0;
  const res = FORM.map(([fc, bw, g]) => {
    const r = Math.exp((-Math.PI * bw) / SR);
    const th = (2 * Math.PI * fc) / SR;
    return { a1: 2 * r * Math.cos(th), a2: -r * r, g: g * (1 - r), y1: 0, y2: 0 };
  });
  const start = Math.floor(lag * SR);
  let i = start;
  while (pos < nf - 1 && i < outLen) {
    const k = Math.floor(pos);
    const fr = pos - k;
    const f = F.a + k;
    const e0 = F.e[f];
    const e1 = F.e[Math.min(F.b, f + 1)];
    const env = e0 + (e1 - e0) * fr;
    const amp = Math.pow(10, ((env * 45 - 45) / 20)) * (env > 0.05 ? 1 : 0);
    const p0 = F.pitch[f];
    let src;
    if (!Number.isNaN(p0)) {
      if (i % 160 === 0) walk = walk * 0.97 + (rand() * 2 - 1) * err * 0.25;
      let semis = p0 + transpose + walk + 0.25 * Math.sin((2 * Math.PI * 5.5 * i) / SR);
      // صوت بشري: نجبره ضمن مدى الحنجرة
      while (semis > 79) semis -= 12;
      while (semis < 45) semis += 12;
      const hz = 440 * Math.pow(2, (semis - 69) / 12);
      phase += hz / SR;
      if (phase >= 1) phase -= 1;
      src = 2 * phase - 1 + (rand() * 2 - 1) * 0.08;
    } else {
      src = (rand() * 2 - 1) * 0.5;
    }
    let y = 0;
    for (const r of res) {
      const v = r.g * src + r.a1 * r.y1 + r.a2 * r.y2;
      r.y2 = r.y1;
      r.y1 = v;
      y += v;
    }
    out[i] = y * amp;
    pos += rate(pos / nf) / 160 * 1; // تقدم إطار لكل 160 عيّنة مع ليّ
    i++;
  }
  // ضجيج غرفة خفيف
  for (let j = 0; j < outLen; j++) out[j] += (rand() * 2 - 1) * 0.002;
  let pk = 0;
  for (const v of out) pk = Math.max(pk, Math.abs(v));
  for (let j = 0; j < outLen; j++) out[j] = (out[j] / (pk || 1)) * gain;
  return out;
}

function noiseBurst(dur, seed = 3) {
  const rand = mulberry32(seed);
  const n = Math.floor(dur * SR);
  const out = new Float32Array(n + SR * 0.2);
  for (let i = 0; i < n; i++) out[i + 1600] = (rand() * 2 - 1) * 0.4 * Math.min(1, i / 400, (n - i) / 400);
  return out;
}

function viaMulaw(x) {
  return mulawDecode(mulawEncode(x));
}

const dir = path.join(ROOT, 'public', 'sounds');
const files = readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort();
const refs = files.map((f) => ({ id: f.replace('.mp3', ''), pcm: decode(path.join(dir, f)), file: path.join(dir, f) }));

const t0 = performance.now();
const feats = refs.map((r) => analyze(r.pcm));
const tAnalyze = (performance.now() - t0) / refs.length;

const rows = [];
const groups = {};
const add = (g, s) => (groups[g] ||= []).push(s);

for (let k = 0; k < refs.length; k++) {
  const r = refs[k];
  const R = feats[k];
  const sc = (pcm) => compare(R, analyze(viaMulaw(pcm)));
  const res = {
    self: sc(r.pcm),
    up5: sc(decode(r.file, 'asetrate=16000*1.33484,aresample=16000,atempo=0.749154')),
    down12: sc(decode(r.file, 'asetrate=8000,aresample=16000,atempo=2.0')),
    slow: sc(decode(r.file, 'atempo=0.84')),
    fast: sc(decode(r.file, 'atempo=1.17')),
    imitU: sc(imitate(r.pcm, { vowel: 'u', transpose: -7, seed: k + 1 })),
    imitA: sc(imitate(r.pcm, { vowel: 'a', transpose: 3, err: 1.0, warp: 0.12, seed: k + 11 })),
    imitBad: sc(imitate(r.pcm, { vowel: 'a', transpose: 0, err: 5, warp: 0.25, seed: k + 21 })),
    noise: sc(noiseBurst(r.pcm.length / SR)),
    fart: sc(fart(k + 5, r.pcm.length / SR)),
    silence: sc(new Float32Array(r.pcm.length)),
  };
  const im = imitate(r.pcm, { vowel: 'u', transpose: -7, seed: k + 1 });
  for (const s of ['echo', 'chop', 'dist', 'chip']) res['sab_' + s] = sc(applySabotage(im, [s], 99 + k));
  const cross = [];
  for (let m = 0; m < refs.length; m++) if (m !== k) cross.push(compare(R, feats[m]).score);
  const crossMax = Math.max(...cross);
  const crossMean = cross.reduce((a, b) => a + b, 0) / cross.length;
  for (const [g, v] of Object.entries(res)) add(g, v.score);
  if (RAWDUMP) for (const [g, v] of Object.entries(res)) (rawGroups[g] ||= []).push(v.parts.raw ?? 0);
  if (RAWDUMP) for (let m = 0; m < refs.length; m++) if (m !== k) (rawGroups.cross ||= []).push(compare(R, feats[m]).parts.raw ?? 0);
  add('crossMean', crossMean);
  add('crossMax', crossMax);
  rows.push({ id: r.id, ...Object.fromEntries(Object.entries(res).map(([g, v]) => [g, v.score])), xMean: Math.round(crossMean), xMax: crossMax });
  if (VERBOSE) {
    console.log(r.id, 'voiced', R.voicedRatio.toFixed(2), 'onsets', R.onsets.length);
    for (const [g, v] of Object.entries(res)) console.log('   ', g.padEnd(9), String(v.score).padStart(3), JSON.stringify(v.parts));
  }
}

console.table(rows);
const avg = (a) => (a.reduce((s, v) => s + v, 0) / a.length).toFixed(1);
console.log('\nمتوسطات:');
for (const [g, v] of Object.entries(groups)) console.log(g.padEnd(10), avg(v), ' min', Math.min(...v).toFixed(0), ' max', Math.max(...v).toFixed(0));

// قياس الأداء: تحليل + مقارنة تسجيل 6 ثوانٍ
const long = imitate(refs[0].pcm, { seed: 5 });
const big = new Float32Array(SR * 6);
big.set(long.subarray(0, Math.min(long.length, big.length)));
const t1 = performance.now();
for (let i = 0; i < 5; i++) compare(feats[0], analyze(big));
console.log(`\nتحليل الأصل: ${tAnalyze.toFixed(1)}ms/صوت — تحليل+مقارنة تسجيل 6ث: ${((performance.now() - t1) / 5).toFixed(1)}ms`);

// إعادة التقطيع
const tone = new Float32Array(48000);
for (let i = 0; i < tone.length; i++) tone[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
const t2 = performance.now();
const rs = resample(tone, 48000, SR);
console.log(`resample 1s 48k→16k: ${(performance.now() - t2).toFixed(1)}ms len=${rs.length}`);

// أعلى أزواج التشابه بين أصوات مختلفة
const pairs = [];
for (let k = 0; k < refs.length; k++) for (let m = 0; m < refs.length; m++) if (k !== m) pairs.push([refs[k].id, refs[m].id, compare(feats[k], feats[m]).score]);
pairs.sort((x, y) => y[2] - x[2]);
console.log('\nأعلى تشابه بين أصوات مختلفة:', pairs.slice(0, 8).map((p) => `${p[0]}←${p[1]}:${p[2]}`).join('  '));

if (RAWDUMP) {
  console.log('\nraw (قبل التحويل لدرجة): متوسط / أقل / أعلى / 20% / 80%');
  for (const [g, v] of Object.entries(rawGroups)) {
    const a = [...v].sort((x, y) => x - y);
    const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    console.log(g.padEnd(10), (a.reduce((s, x) => s + x, 0) / a.length).toFixed(3), a[0].toFixed(3), a[a.length - 1].toFixed(3), q(0.2).toFixed(3), q(0.8).toFixed(3));
  }
}
