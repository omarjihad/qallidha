// إعلانات AdsGram: فيديو بمكافأة + إعلان كامل الشاشة بنهاية اللعبة.
// تشتغل بس داخل تيليجرام، وبس إذا الأدمن حط أرقام البلوكات بـCloudflare.

import { insideTelegram } from './tg.js';

const SDK = 'https://sad.adsgram.ai/js/sad.min.js';
let sdkPromise = null;
const controllers = new Map();

function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      if (window.Adsgram) return resolve(window.Adsgram);
      const s = document.createElement('script');
      s.src = SDK;
      s.async = true;
      s.onload = () => (window.Adsgram ? resolve(window.Adsgram) : reject(new Error('AdsGram')));
      s.onerror = () => {
        sdkPromise = null;
        reject(new Error('ما تحمّلت الإعلانات — تأكد من النت'));
      };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

async function controller(blockId) {
  const A = await loadSdk();
  if (!controllers.has(blockId)) controllers.set(blockId, A.init({ blockId: String(blockId) }));
  return controllers.get(blockId);
}

export class Ads {
  constructor(cfg = {}) {
    this.cfg = cfg || {};
    this.lastRewardedAt = 0;
    this.busy = false;
  }

  /** إعلانات المكافأة متاحة؟ */
  get rewarded() {
    return insideTelegram && !!this.cfg.rewarded;
  }

  get interstitial() {
    return insideTelegram && !!this.cfg.interstitial;
  }

  /** يعرض فيديو مكافأة. يرجع {done:true} إذا كمّله للآخر. */
  async showRewarded() {
    if (!this.rewarded) return { done: false, error: 'الإعلانات تشتغل بس داخل تيليجرام' };
    if (this.busy) return { done: false, error: 'busy' };
    this.busy = true;
    try {
      const c = await controller(this.cfg.rewarded);
      const r = await c.show();
      const done = !r || r.done !== false;
      if (done) this.lastRewardedAt = Date.now();
      return { done };
    } catch (r) {
      const skipped = r && r.error === false;
      return { done: false, error: skipped ? 'لازم تكمّل الإعلان للآخر حتى تاخذ الجائزة' : 'ماكو إعلان هسه، جرّب بعد شوية' };
    } finally {
      this.busy = false;
    }
  }

  /** إعلان كامل الشاشة (نهاية اللعبة). ما يطلع إذا شاف إعلان مكافأة قبل أقل من 3 دقايق. */
  async showInterstitial() {
    if (!this.interstitial || this.busy) return { done: false };
    if (Date.now() - this.lastRewardedAt < 3 * 60 * 1000) return { done: false, skipped: true };
    this.busy = true;
    try {
      const c = await controller(this.cfg.interstitial);
      await c.show();
      return { done: true };
    } catch {
      return { done: false };
    } finally {
      this.busy = false;
    }
  }
}
