// ترميز IMA ADPCM (4 بت للعينة) للدردشة الصوتية — بدون أي شي خاص بالمتصفح حتى ينفحص بـnode هم.

const IDX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const STEP = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209,
  230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749,
  3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623,
  27086, 29794, 32767,
];
const clamp16 = (v) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);

/** ترميز: [pred lo, pred hi, index, ...نص بايت لكل عينة]. كل قطعة تنفك لوحدها (لو ضاعت وحدة ما تخرب الباقي) */
export function adpcmEncode(pcm, state = { pred: 0, index: 0 }) {
  const n = pcm.length;
  const out = new Uint8Array(3 + Math.ceil(n / 2));
  let pred = state.pred;
  let index = state.index;
  out[0] = pred & 255;
  out[1] = (pred >> 8) & 255;
  out[2] = index;
  for (let i = 0; i < n; i++) {
    const s = clamp16(Math.round(pcm[i] * 32767));
    let step = STEP[index];
    let diff = s - pred;
    let code = 0;
    if (diff < 0) {
      code = 8;
      diff = -diff;
    }
    let delta = step >> 3;
    if (diff >= step) {
      code |= 4;
      diff -= step;
      delta += step;
    }
    step >>= 1;
    if (diff >= step) {
      code |= 2;
      diff -= step;
      delta += step;
    }
    step >>= 1;
    if (diff >= step) {
      code |= 1;
      delta += step;
    }
    pred = clamp16(code & 8 ? pred - delta : pred + delta);
    index = Math.max(0, Math.min(88, index + IDX[code]));
    const k = 3 + (i >> 1);
    if (i & 1) out[k] |= code << 4;
    else out[k] = code;
  }
  state.pred = pred;
  state.index = index;
  return out;
}

export function adpcmDecode(u8) {
  if (!u8 || u8.length < 4) return new Float32Array(0);
  let pred = ((u8[0] | (u8[1] << 8)) << 16) >> 16;
  let index = Math.min(88, u8[2]);
  const n = (u8.length - 3) * 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = u8[3 + (i >> 1)];
    const code = i & 1 ? b >> 4 : b & 15;
    const step = STEP[index];
    let delta = step >> 3;
    if (code & 4) delta += step;
    if (code & 2) delta += step >> 1;
    if (code & 1) delta += step >> 2;
    pred = clamp16(code & 8 ? pred - delta : pred + delta);
    index = Math.max(0, Math.min(88, index + IDX[code]));
    out[i] = pred / 32768;
  }
  return out;
}
