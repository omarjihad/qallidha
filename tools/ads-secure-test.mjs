// اختبار وضع الإعلانات الآمن: المكافأة ما تنضاف إلا من رابط AdsGram (Reward URL) بالمفتاح الصح.
// التشغيل: npx wrangler dev --port 8788 --persist-to /tmp/wr2 --var ADSGRAM_REWARD_KEY:k3y-secret
//   ثم: BASE=http://127.0.0.1:8788 KEY=k3y-secret node tools/ads-secure-test.mjs
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const KEY = process.env.KEY || 'k3y-secret';
const TOKEN = process.env.TOKEN || '123456:TEST-token_abcdefghijklmnop';
const ID = 880000 + Math.floor(Math.random() * 9999);
let ok = 0;
let bad = 0;
const check = (cond, label) => {
  if (cond) ok++;
  else bad++;
  console.log(cond ? '✅' : '❌', label);
};
function signInitData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAsec', user: JSON.stringify(user) });
  const pairs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(pairs).digest('hex'));
  return p.toString();
}
const initData = signInitData({ id: ID, first_name: 'Sec' });
const api = async (path, body = {}) => {
  const r = await fetch(BASE + path, { method: 'POST', body: JSON.stringify({ initData, ...body }) });
  return { status: r.status, ...(await r.json()) };
};
const reward = async (key, id = ID) => {
  const r = await fetch(`${BASE}/api/adsgram/reward?userid=${id}&key=${encodeURIComponent(key)}`);
  return { status: r.status, body: await r.text() };
};

const me = await api('/api/me');
check(me.profile && me.profile.mics === 0, 'حساب جديد');
const intent = await api('/api/ads/intent', { kind: 'coins' });
check(intent.ok && intent.nonce, 'نية إعلان');
let done = await api('/api/ads/done', { nonce: intent.nonce });
check(done.pending && !done.result && done.profile.mics === 0, 'قبل رابط AdsGram: بالانتظار وبدون مكافأة');
let r = await reward('wrong');
check(r.status === 403, 'رابط بمفتاح غلط مرفوض (403)');
r = await reward(KEY);
check(r.status === 200 && JSON.parse(r.body).ok === true, 'رابط AdsGram بالمفتاح الصح');
done = await api('/api/ads/done', { nonce: intent.nonce });
check(done.result && done.result.mics === 20 && done.profile.mics === 20, 'المكافأة وصلت: +20');
r = await reward(KEY);
done = await api('/api/me');
check(done.profile.mics === 20, 'نفس الإعلان ما ينحسب مرتين');
r = await reward(KEY, ID + 1);
check(r.status === 200 && JSON.parse(r.body).ok === false, 'لاعب بدون إعلان منتظر: ما ياخذ شي');

console.log(`\n${ok} نجح، ${bad} فشل`);
process.exit(bad ? 1 : 0);
