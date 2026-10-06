// الحساب داخل اللعبة: اللفل والمايكات، المتجر واللبس، الرويال باس، الصندوق اليومي، الشراء بالنجوم، ومكافآت نهاية اللعبة.
// كل شي هنا للاعبين تيليجرام (الضيف يلعب عادي بس ما يجمع).

import { ITEMS, ITEM, CUR, RARITY, PASS, passReward, levelProgress, isFree, ADS, STAR_PACKS, packPrice, packBonus, MAX_LEVEL, pointsForLevel, levelReward } from './catalog.js';
import { THEMES, portrait } from './stage.js';
import { $, el, toast, overlay } from './ui.js';
import { authBody } from './net.js';
import { haptic, tg as webApp } from './tg.js';
import { Ads } from './ads.js';
import { t, LANG, plusNum as plus } from './i18n.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
/** «300 مايك» — بالروسي «300 🎤» */
const mics = (n, signed = false) => t('{s} مايك', { s: signed ? plus(n) : fmt(n), n });

async function post(path, body = {}) {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...authBody(), ...body }) });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ...data };
  } catch {
    return { status: 0, error: 'ماكو اتصال' };
  }
}

const TABS = [
  ['skin', '🎭 شخصيات'],
  ['head', '🎩 قبعات'],
  ['face', '🕶️ وجه'],
  ['stage', '🏟️ مسارح'],
  ['mics', '🎤 مايكات'],
];

/** وين ينطي الباس هذا الغرض (للعرض) */
const PASS_SOURCE = (() => {
  const m = new Map();
  for (let l = 1; l <= PASS.premiumMax; l++) {
    for (const track of ['free', 'premium']) {
      const r = passReward(l, track);
      if (r && r.item && !m.has(r.item)) m.set(r.item, { track, level: l });
    }
  }
  return m;
})();

export class Meta {
  constructor(config = {}) {
    this.profile = null;
    this.listeners = new Set();
    this.panel = null; // {kind, render}
    this.setConfig(config);
  }

  setConfig(cfg) {
    this.config = cfg || {};
    this.ads = new Ads(this.config.ads || {});
  }

  get tg() {
    return !!this.profile;
  }

  /** باقات النجوم (من السيرفر، وإلا من الكتالوج) */
  packs(kind) {
    const list = this.config.packs || STAR_PACKS.map((p) => ({ ...p, stars: packPrice(p, this.config.passPrice || 99) }));
    return list.filter((p) => !kind || p.kind === kind);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(profile) {
    if (!profile) return;
    this.profile = profile;
    for (const fn of this.listeners) fn(profile);
    // نعيد رسم اللوحة بس إذا بعدها مفتوحة (ممكن اللعبة سكّرتها)
    if (this.panel) {
      if (this.panel.el && this.panel.el.isConnected) this.panel.render();
      else this.panel = null;
    }
  }

  async refresh() {
    const r = await post('/api/me');
    if (r.profile) this.set(r.profile);
    return r;
  }

  /** شكلي الحالي: {skin, acc, stage} */
  look() {
    const e = (this.profile && this.profile.equip) || {};
    const sk = e.skin && ITEM.get(e.skin);
    return { skin: sk ? sk.skin : null, acc: { head: e.head || null, face: e.face || null }, stage: e.stage || 'stage:classic' };
  }

  tgOnly() {
    toast(t('افتح اللعبة من تيليجرام حتى تجمع مايكات وتلعب الباس'), 3500);
    return null;
  }

  /* ============================================================ الإعلانات بمكافأة */

  async watchAd(kind, item = null) {
    if (!this.tg) return this.tgOnly();
    if (!this.ads.rewarded) {
      toast(t('الإعلانات بعدها ما مفعّلة'));
      return null;
    }
    const intent = await post('/api/ads/intent', { kind, item });
    if (!intent.ok) {
      toast(t(intent.error || intent.message || 'ما ينفع هسه'), 3000);
      return null;
    }
    const shown = await this.ads.showRewarded();
    if (!shown.done) {
      if (shown.error && shown.error !== 'busy') toast(t(shown.error), 3000);
      return null;
    }
    // إذا رابط المكافأة مضبوط بـAdsGram، المكافأة تجي من سيرفرهم: ننتظرها شوية
    for (let i = 0; i < 12; i++) {
      const r = await post('/api/ads/done', { nonce: intent.nonce });
      if (r.profile) this.set(r.profile);
      if (r.result) {
        this.announce(r.result);
        return r.result;
      }
      if (r.error && !r.pending) {
        toast(t(r.error), 3000);
        return null;
      }
      await sleep(900);
    }
    toast(t('المكافأة بالطريق — تنضاف لحسابك من توصل'), 3500);
    return null;
  }

  announce(res) {
    if (!res) return;
    if (res.error) return toast(t(res.error), 3000);
    haptic('success');
    const it = res.item && ITEM.get(res.item);
    const passMsg = (p) => (p ? t('🎖️ {xp} خبرة باس', { xp: plus(p.xp) }) + (p.to > p.from ? t(' — لفل {n}!', { n: p.to }) : '') : '');
    switch (res.kind) {
      case 'coins':
      case 'double':
        return toast(`${CUR.icon} ${mics(res.mics, true)}`);
      case 'pass':
        return toast(passMsg(res.pass));
      case 'box':
        if (it) return toast(t('🎁 طلعلك: {item}!', { item: `${it.icon} ${t(it.name)}` }), 3500);
        if (res.pass) return toast('🎁 ' + passMsg(res.pass), 3500);
        return toast(`🎁 ${mics(res.mics, true)}`, 3000);
      case 'unlock':
        if (res.unlocked) return toast(t('🔓 انفتح: {item}!', { item: it ? `${it.icon} ${t(it.name)}` : '' }), 3500);
        return toast(t('🎬 {n}/{need} — باقي {left} إعلانات', { n: res.n, need: res.need, left: res.need - res.n }), 3000);
      case 'trial':
        return toast(t('⏳ تكدر تلبس {item} 24 ساعة', { item: it ? t(it.name) : t('الغرض') }), 3000);
      default:
    }
  }

  /* ============================================================ الشراء بالنجوم ⭐ */

  /** يطلب فاتورة نجوم ويفتحها داخل تيليجرام، وبعد الدفع ينتظر لحد ما توصل المشتريات */
  async payStars(path, body, waitFor, done) {
    if (!this.tg) return this.tgOnly();
    if (!webApp || !webApp.openInvoice) return toast(t('الدفع بالنجوم يشتغل داخل تيليجرام بس'), 3000);
    const r = await post(path, { ...body, lang: LANG });
    if (!r.ok) {
      haptic('error');
      return toast(t(r.error || 'ما زبطت الفاتورة'), 3000);
    }
    const before = this.profile ? { mics: this.profile.mics, xp: this.profile.pass.xp, premium: this.profile.pass.premium } : null;
    webApp.openInvoice(r.link, async (status) => {
      if (status === 'paid') {
        toast(t('🎉 تم الدفع! جاري التسليم…'), 2500);
        for (let i = 0; i < 12; i++) {
          await sleep(1100);
          const me = await this.refresh();
          if (me.profile && waitFor(me.profile, before)) {
            haptic('success');
            toast(done(me.profile), 3500);
            return;
          }
        }
        toast(t('الدفع وصل — إذا ما بان، سكّر اللعبة وافتحها'), 4000);
      } else if (status === 'failed') toast(t('ما تم الدفع'), 2500);
    });
    return null;
  }

  buyPass() {
    return this.payStars(
      '/api/pass/invoice',
      {},
      (p) => p.pass.premium,
      () => t('🎖️ تفعّل الرويال باس المميز!'),
    );
  }

  buyPack(sku) {
    const pack = this.packs().find((p) => p.sku === sku);
    if (!pack) return null;
    const changed = (p, b) => !b || p.mics !== b.mics || p.pass.xp !== b.xp || p.pass.premium !== b.premium;
    return this.payStars('/api/stars/invoice', { sku }, changed, (p) => {
      if (pack.kind === 'mics') return t('🎤 انضاف {s} لرصيدك!', { s: mics(pack.mics) });
      if (pack.kind === 'passplus') return t('🎖️ تفعّل المميز وصرت لفل {n}!', { n: p.pass.level });
      return t('🎖️ الباس صار لفل {n}!', { n: p.pass.level });
    });
  }

  /** يكدر يشتري باقة لفلات هسه؟ */
  canLevels(pack) {
    const ps = this.profile && this.profile.pass;
    return !!ps && ps.level + pack.levels <= ps.cap;
  }

  /* ============================================================ المتجر */

  async buy(id) {
    const it = ITEM.get(id);
    if (!this.tg) return this.tgOnly();
    if (this.profile.mics < it.price) {
      haptic('error');
      return toast(t('ناقصك {s}', { s: mics(it.price - this.profile.mics) }), 2500);
    }
    const r = await post('/api/shop/buy', { item: id });
    if (r.profile) this.set(r.profile);
    if (r.ok) {
      haptic('success');
      toast(t('✅ صار عندك {item}', { item: `${it.icon} ${t(it.name)}` }));
      await this.equip(it.type, id, true);
    } else toast(t(r.error || 'ما زبط'), 2500);
  }

  async equip(slot, id, quiet = false) {
    if (!this.tg) return this.tgOnly();
    const r = await post('/api/shop/equip', { slot, item: id });
    if (r.profile) this.set(r.profile);
    if (!r.ok) toast(t(r.error || 'ما زبط'), 2500);
    else if (!quiet) haptic('select');
    if (this.onLook) this.onLook();
  }

  itemState(it) {
    const p = this.profile;
    const now = Date.now();
    const owned = p ? p.owned[it.id] : undefined;
    const forever = isFree(it) || owned === 0;
    const trial = !forever && owned > now ? owned : 0;
    const equipped = p ? p.equip[it.type] === it.id : it.id === 'stage:classic';
    return { forever, trial, has: forever || !!trial, equipped, adN: (p && p.adProgress[it.id]) || 0 };
  }

  preview(it) {
    if (it.type === 'stage') {
      const T = THEMES[it.id] || THEMES['stage:classic'];
      const [r, g, b] = T.floor.rgb;
      return el(
        'div',
        { class: 'it-stage', style: { background: `linear-gradient(180deg, ${T.wall[0]}, ${T.wall[1]} 62%, rgb(${r},${g},${b}) 62%)` } },
        el('span', {}, it.icon),
      );
    }
    let src;
    try {
      if (it.type === 'skin') src = portrait(it.skin);
      else {
        const lk = this.look();
        src = portrait(lk.skin == null ? 0 : lk.skin, { head: it.type === 'head' ? it.id : null, face: it.type === 'face' ? it.id : null });
      }
    } catch {
      src = '';
    }
    return src ? el('img', { class: 'it-img', src, alt: '' }) : el('div', { class: 'it-emoji' }, it.icon);
  }

  itemCard(it) {
    const st = this.itemState(it);
    const rar = RARITY[it.rarity] || RARITY.common;
    const actions = [];
    const btn = (label, cls, fn) => el('button', { class: 'it-btn ' + cls, onclick: (e) => (e.stopPropagation(), fn()) }, label);
    if (st.has) {
      if (st.equipped) {
        actions.push(el('div', { class: 'it-on' }, it.type === 'stage' ? t('✓ مختار') : t('✓ لابسه')));
        if (it.type === 'head' || it.type === 'face') actions.push(btn(t('شيل'), 'ghost', () => this.equip(it.type, null)));
      } else actions.push(btn(it.type === 'stage' ? t('اختاره') : t('البسه'), 'green', () => this.equip(it.type, it.id)));
      if (st.trial) actions.push(el('div', { class: 'it-note' }, t('⏳ تجربة: باقي {h} ساعة', { h: Math.max(1, Math.ceil((st.trial - Date.now()) / 3600000)) })));
    }
    if (!st.forever) {
      if (it.price != null) {
        const poor = !this.profile || this.profile.mics < it.price;
        actions.push(btn(`${CUR.icon} ${fmt(it.price)}`, 'buy' + (poor ? ' poor' : ''), () => this.buy(it.id)));
      }
      if (it.ads && this.ads.rewarded) actions.push(btn(`🎬 ${st.adN}/${it.ads}`, 'ad', () => this.watchAd('unlock', it.id)));
      if (it.price != null && !st.trial && this.ads.rewarded) actions.push(btn(t('جرّب 24س 🎬'), 'try', () => this.watchAd('trial', it.id)));
      if (it.pass) {
        const src = PASS_SOURCE.get(it.id);
        const where = it.pass === 'premium' ? t('🎖️ الباس المميز') : t('🎖️ الباس المجاني');
        actions.push(el('div', { class: 'it-note pass ' + it.pass }, src ? t('{where} — لفل {n}', { where, n: src.level }) : where));
      }
    }
    return el(
      'div',
      { class: 'it-card' + (st.equipped ? ' equipped' : '') + (st.has ? ' has' : ''), style: { '--rar': rar.color } },
      el('div', { class: 'it-prev' }, this.preview(it), el('span', { class: 'it-rar' }, t(rar.name))),
      el('div', { class: 'it-name' }, t(it.name)),
      el('div', { class: 'it-acts' }, actions),
    );
  }

  micsTab() {
    const p = this.profile;
    const cards = [];
    const card = (icon, title, sub, button, cls = '') =>
      el('div', { class: 'earn-card' + cls }, el('div', { class: 'earn-ic' }, icon), el('div', { class: 'earn-t' }, title), el('div', { class: 'earn-s' }, sub), button);
    const adBtn = (label, ok, fn) => el('button', { class: 'it-btn ad' + (ok ? '' : ' poor'), onclick: fn }, label);
    if (!this.ads.rewarded) cards.push(card('🎬', t('الإعلانات بعدها ما مفعّلة'), t('العب وجمّع مايكات من كل لعبة'), null));
    else {
      cards.push(card(CUR.icon, mics(ADS.coins.mics, true), t('باقي {n} من {m} اليوم', { n: p.daily.coins, m: ADS.coins.perDay }), adBtn(t('🎬 شاهد'), p.daily.coins > 0, () => this.watchAd('coins'))));
      cards.push(card('🎁', t('صندوق اليوم'), p.daily.box > 0 ? t('مايكات أو إكسسوار أو خبرة باس') : t('فتحته اليوم — ارجع باچر'), adBtn(t('🎬 افتح'), p.daily.box > 0, () => this.watchAd('box'))));
      if (p.lastGame && p.lastGame.canDouble) cards.push(card('✖️2', t('ضاعف آخر لعبة'), mics(p.lastGame.mics, true), adBtn(t('🎬 ضاعف'), true, () => this.watchAd('double'))));
    }
    cards.push(card('🎮', t('العب'), t('كل لعبة تنطيك مايكات حسب نقاطك، والفائز ويا ربعه +15، وكل لفل جديد مكافأة'), null));
    // باقات النجوم
    const starCards = this.packs('mics').map((pk) => {
      const bonus = packBonus(pk);
      return card(
        pk.icon || CUR.icon,
        mics(pk.mics),
        bonus > 0 ? t('{b}% زيادة 🔥', { b: plus(bonus) }) : t('الباقة الأساسية'),
        el('button', { class: 'it-btn star', onclick: () => this.buyPack(pk.sku) }, `⭐ ${pk.stars}`),
        ' star' + (bonus >= 50 ? ' best' : ''),
      );
    });
    return el(
      'div',
      { class: 'mics-tab' },
      el('div', { class: 'earn-grid' }, cards),
      starCards.length ? el('div', { class: 'star-head' }, t('⭐ اشتري مايكات بنجوم تيليجرام')) : null,
      starCards.length ? el('div', { class: 'earn-grid' }, starCards) : null,
    );
  }

  openShop({ tab = 'skin', onClose = null } = {}) {
    if (!this.tg) return this.tgOnly();
    let cur = tab;
    let scroller = null;
    const render = () => {
      const keepScroll = scroller ? scroller.scrollTop : 0;
      const p = this.profile;
      const body =
        cur === 'mics'
          ? this.micsTab()
          : el(
              'div',
              { class: 'it-grid' },
              ITEMS.filter((x) => x.type === cur)
                .slice()
                .sort((a, b) => Number(this.itemState(b).has) - Number(this.itemState(a).has) || (a.price ?? 1e9) - (b.price ?? 1e9))
                .map((it) => this.itemCard(it)),
            );
      scroller = el('div', { class: 'shop-body' }, body);
      const panel = el(
        'div',
        { class: 'panel shop' },
        el('button', { class: 'xbtn', 'aria-label': t('سكّر'), onclick: close }, '✕'),
        el(
          'div',
          { class: 'shop-head' },
          el('div', { class: 'panel-title' }, t('🛒 المتجر')),
          el('button', { class: 'mics-pill', onclick: () => ((cur = 'mics'), (scroller = null), render()) }, `${CUR.icon} ${fmt(p.mics)}`, el('span', { class: 'pill-plus' }, '+')),
        ),
        el(
          'div',
          { class: 'tabs' },
          TABS.map(([k, label]) => el('button', { class: 'tab' + (k === cur ? ' on' : ''), onclick: () => ((cur = k), (scroller = null), render()) }, t(label))),
        ),
        scroller,
      );
      this.mount(panel);
      scroller.scrollTop = keepScroll;
    };
    const close = () => {
      this.panel = null;
      if (onClose) onClose();
    };
    this.panel = { kind: 'shop', render };
    render();
  }

  /** يعرض اللوحة؛ إذا نفس اللوحة مفتوحة يبدّلها بمكانها بدون أنيميشن الفتح */
  mount(panel) {
    const prev = this.panel && this.panel.el;
    if (prev && prev.isConnected) {
      panel.classList.add('still');
      prev.replaceWith(panel);
    } else overlay(panel, 'panel-layer');
    if (this.panel) this.panel.el = panel;
  }

  /* ============================================================ الرويال باس */

  rewardCell(r, reached, locked) {
    if (!r) return el('div', { class: 'rp-cell empty' }, '—');
    const it = r.item && ITEM.get(r.item);
    return el(
      'div',
      { class: 'rp-cell' + (reached ? ' got' : '') + (locked ? ' locked' : '') + (it ? ' item' : ''), style: it ? { '--rar': (RARITY[it.rarity] || RARITY.common).color } : null },
      el('div', { class: 'rp-ic' }, it ? it.icon : CUR.icon),
      el('div', { class: 'rp-lb' }, it ? t(it.name) : plus(r.mics)),
      locked ? el('div', { class: 'rp-lock' }, '🔒') : reached ? el('div', { class: 'rp-ok' }, '✓') : null,
    );
  }

  openPass({ onClose = null } = {}) {
    if (!this.tg) return this.tgOnly();
    let track = null;
    const render = () => {
      const p = this.profile;
      const ps = p.pass;
      const days = Math.max(1, Math.ceil((ps.endsAt - Date.now()) / 86400000));
      const inLevel = ps.level >= ps.cap ? PASS.xpPerLevel : ps.xp % PASS.xpPerLevel;
      const keep = track ? track.scrollLeft : null;
      const cols = [];
      for (let l = 1; l <= PASS.premiumMax; l++) {
        const reached = l <= ps.level;
        cols.push(
          el(
            'div',
            { class: 'rp-col' + (l === ps.level ? ' cur' : '') + (reached ? ' reached' : '') + (l % 5 === 0 ? ' big' : '') },
            el('div', { class: 'rp-lv' }, String(l)),
            this.rewardCell(passReward(l, 'free'), reached && l <= PASS.freeMax, false),
            this.rewardCell(passReward(l, 'premium'), reached && ps.premium, !ps.premium),
          ),
        );
      }
      track = el('div', { class: 'rp-track' }, el('div', { class: 'rp-rows' }, el('div', { class: 'rp-tag free' }, t('مجاني')), el('div', { class: 'rp-tag prem' }, t('⭐ مميز'))), cols);
      const adLeft = p.daily.pass;
      const plusPack = this.packs('passplus')[0];
      const lvPacks = this.packs('levels');
      const panel = el(
        'div',
        { class: 'panel pass' },
        el('button', { class: 'xbtn', 'aria-label': t('سكّر'), onclick: close }, '✕'),
        el(
          'div',
          { class: 'pass-head' },
          el(
            'div',
            {},
            el('div', { class: 'panel-title' }, t('🎖️ الرويال باس — الموسم {s}', { s: ps.season })),
            el('div', { class: 'hint' }, t('باقي {d} يوم · كل {xp} خبرة = لفل · نقاطك باللعب = خبرة', { d: days, xp: PASS.xpPerLevel })),
          ),
          ps.premium
            ? el('div', { class: 'prem-badge' }, t('⭐ مميز — 100 لفل'))
            : el(
                'div',
                { class: 'prem-btns' },
                el('button', { class: 'btn gold', onclick: () => this.buyPass() }, t('⭐ {p} — افتح 100 لفل', { p: this.config.passPrice || 99 })),
                plusPack ? el('button', { class: 'btn gold plus', onclick: () => this.buyPack(plusPack.sku) }, t('⭐ {p} — مميز + 10 لفلات', { p: plusPack.stars })) : null,
              ),
        ),
        el(
          'div',
          { class: 'pass-prog' },
          el('div', { class: 'pass-lv' }, el('small', {}, t('لفل')), el('b', {}, String(ps.level)), el('small', {}, t('من {n}', { n: ps.cap }))),
          el(
            'div',
            { class: 'pass-bar' },
            el('i', { style: { width: `${Math.round((inLevel / PASS.xpPerLevel) * 100)}%` } }),
            el('span', {}, ps.level >= ps.cap ? (ps.premium ? t('خلصت الباس 🎉') : t('وصلت 50 — المميز يفتح لحد 100')) : t('{a} / {b} خبرة', { a: inLevel, b: PASS.xpPerLevel })),
          ),
          this.ads.rewarded
            ? el('button', { class: 'it-btn ad' + (adLeft > 0 ? '' : ' poor'), onclick: () => this.watchAd('pass') }, t('🎬 {xp} خبرة ({n})', { xp: plus(PASS.adXp), n: adLeft }))
            : null,
        ),
        lvPacks.length
          ? el(
              'div',
              { class: 'lv-buy' },
              el('span', { class: 'lv-buy-t' }, t('⭐ اشتري لفلات:')),
              lvPacks.map((pk) =>
                el(
                  'button',
                  { class: 'it-btn star' + (this.canLevels(pk) ? '' : ' poor'), onclick: () => this.buyPack(pk.sku) },
                  el('b', {}, plus(pk.levels)),
                  ` · ⭐${pk.stars}`,
                ),
              ),
            )
          : null,
        track,
      );
      this.mount(panel);
      const curCol = track.querySelector('.rp-col.cur') || track.querySelector('.rp-col');
      if (keep != null) track.scrollLeft = keep;
      else if (curCol) curCol.scrollIntoView({ inline: 'center', block: 'nearest' });
    };
    const close = () => {
      this.panel = null;
      if (onClose) onClose();
    };
    this.panel = { kind: 'pass', render };
    render();
  }

  /* ============================================================ واجهات صغيرة */

  /** شارة الحساب بالقائمة: اللفل والمايكات */
  chip(user, { onClose = null } = {}) {
    const name = (user && user.name) || '';
    const photo = user && user.photo;
    const p = this.profile;
    const lp = p ? p.level : levelProgress(0);
    return el(
      'button',
      { class: 'profile-chip', 'aria-label': t('⭐ اللفلات'), onclick: () => this.openLevels({ onClose }) },
      photo ? el('img', { src: photo, alt: '' }) : el('span', { class: 'pc-ph' }, (name || '؟').slice(0, 1)),
      el(
        'div',
        { class: 'pc-info' },
        el('b', {}, name),
        p
          ? el(
              'div',
              { class: 'pc-row' },
              el('span', { class: 'lv-badge' }, `⭐ ${lp.level}`),
              el('span', { class: 'lv-bar' }, el('i', { style: { width: `${Math.round(lp.frac * 100)}%` } })),
              el('span', { class: 'pc-mics' }, `${CUR.icon} ${fmt(p.mics)}`),
            )
          : el('small', {}, t('ضيف — افتح من تيليجرام حتى تجمع')),
      ),
    );
  }

  /* ============================================================ اللفلات (من الضغط على اسمك وصورتك) */

  /** كم لفل باللعبة، جائزة كل لفل، شلون توصله، وشكد باقيلك */
  openLevels({ onClose = null } = {}) {
    if (!this.tg) return this.tgOnly();
    haptic('light');
    const p = this.profile;
    const pts = p.points || 0;
    const lp = p.level;
    const max = lp.level >= MAX_LEVEL;
    const next = Math.min(MAX_LEVEL, lp.level + 1);
    const left = Math.max(0, lp.to - pts);
    const close = () => {
      this.panel = null;
      if (onClose) onClose();
    };
    const rows = [];
    let curRow = null;
    for (let L = 1; L <= MAX_LEVEL; L++) {
      const need = pointsForLevel(L);
      const done = L <= lp.level;
      const row = el(
        'div',
        { class: 'lv-row' + (done ? ' done' : '') + (L === lp.level ? ' cur' : '') + (L === next && !max ? ' next' : '') + (L % 10 === 0 ? ' big' : '') },
        el('span', { class: 'lv-n' }, String(L)),
        el('span', { class: 'lv-need' }, L === 1 ? t('البداية') : t('{n} نقطة', { n: fmt(need) })),
        el('span', { class: 'lv-rw' }, L === 1 ? '—' : `${CUR.icon} ${fmt(levelReward(L))}`),
        el('span', { class: 'lv-st' }, done ? '✅' : L === next ? t('باقي {n}', { n: fmt(need - pts) }) : '🔒'),
      );
      if (L === lp.level) curRow = row;
      rows.push(row);
    }
    const list = el('div', { class: 'lv-list' }, rows);
    const panel = el(
      'div',
      { class: 'panel levels' },
      el('button', { class: 'xbtn', 'aria-label': t('سكّر'), onclick: close }, '✕'),
      el('div', { class: 'panel-title' }, t('⭐ اللفلات')),
      el(
        'div',
        { class: 'lv-top' },
        el(
          'div',
          { class: 'lv-now' },
          el('div', { class: 'lv-big' }, String(lp.level)),
          el('small', {}, t('لفلك من {max}', { max: MAX_LEVEL })),
        ),
        el(
          'div',
          { class: 'lv-prog' },
          el('div', { class: 'lv-bar big' }, el('i', { style: { width: `${Math.round(lp.frac * 100)}%` } })),
          el(
            'div',
            { class: 'lv-left' },
            max
              ? t('🏆 وصلت آخر لفل!')
              : t('باقيلك {n} نقطة للفل {L} — جائزته {r}', { n: fmt(left), L: next, r: `${CUR.icon} ${fmt(levelReward(next))}` }),
          ),
          el('div', { class: 'lv-total' }, t('مجموع نقاطك: {n}', { n: fmt(pts) })),
        ),
      ),
      el(
        'div',
        { class: 'lv-how' },
        el('div', {}, t('🎮 شلون تصعد: كل نقطة تجيبها باللعب (درجة التقليد + العجلة) تنحسب للفل')),
        el('div', {}, t('🎁 كل لفل جديد = {a} مايك، وكل 10 لفلات = {b} مايك', { a: levelReward(2), b: levelReward(10) })),
        el('div', {}, t('📈 كل ما يصعد اللفل يحتاج نقاط أكثر شوية — والعب ويا ربعك حتى تجمع أسرع')),
      ),
      list,
    );
    this.panel = { kind: 'levels', render: () => null };
    this.mount(panel);
    // نبدي القائمة من لفلك الحالي
    requestAnimationFrame(() => {
      if (curRow) list.scrollTop = Math.max(0, curRow.offsetTop - list.offsetTop - list.clientHeight / 2 + curRow.offsetHeight / 2);
    });
  }

  /** مكافآت نهاية اللعبة (لي أنا) */
  rewardsStrip(reward) {
    if (!reward) return null;
    const micsB = el('b', {}, plus(reward.mics));
    const items = [el('div', { class: 'rw' }, micsB, el('span', {}, `${CUR.icon} ${t('مايكات')}`))];
    if (reward.lvTo > reward.lvFrom)
      items.push(el('div', { class: 'rw up' }, el('b', {}, `⭐ ${reward.lvFrom} ← ${reward.lvTo}`), el('span', {}, t('لفل جديد {s}', { s: `${plus(reward.levelMics)} ${CUR.icon}` }))));
    if (reward.pass) {
      const p = reward.pass;
      items.push(el('div', { class: 'rw' }, el('b', {}, plus(p.xp)), el('span', {}, p.to > p.from ? t('🎖️ باس لفل {n}!', { n: p.to }) : t('🎖️ خبرة باس'))));
      for (const r of (p.rewards || []).filter((x) => x.item)) {
        const it = ITEM.get(r.item);
        if (it) items.push(el('div', { class: 'rw up' }, el('b', {}, it.icon), el('span', {}, r.dup ? `${t(it.name)} (${plus(r.dup)} ${CUR.icon})` : t(it.name))));
      }
    }
    // مسابقة المتصدرين: نقاط هاللعبة وترتيبك (أو تنبيه إن اللعب وحدك ما ينحسب)
    if (reward.contest) {
      const c = reward.contest;
      if (c.solo) items.push(el('div', { class: 'rw ct solo' }, el('b', {}, '🔥'), el('span', {}, t('اللعب وحدك ما ينحسب للمسابقة'))));
      else items.push(el('div', { class: 'rw ct' }, el('b', {}, `🔥 ${plus(c.pts)}`), el('span', {}, c.rank ? t('ترتيبك بالمسابقة #{n}', { n: c.rank }) : t('نقاط المسابقة'))));
    }
    const can = this.ads.rewarded && this.profile && this.profile.lastGame && this.profile.lastGame.canDouble && this.profile.lastGame.gkey === reward.gkey;
    const strip = el('div', { class: 'rewards' }, el('div', { class: 'rw-title' }, t('🎁 مكافآتك')), el('div', { class: 'rw-items' }, items));
    if (can) {
      const b = el(
        'button',
        {
          class: 'btn gold',
          onclick: async () => {
            b.disabled = true;
            const r = await this.watchAd('double');
            if (r && !r.error) {
              b.remove();
              micsB.textContent = `⁦+${fmt(reward.mics + (r.mics || reward.mics))} ×2⁩`;
              micsB.parentElement.classList.add('up');
            } else b.disabled = false;
          },
        },
        t('🎬 ضاعف مايكاتك ({s})', { s: plus(reward.mics) }),
      );
      strip.appendChild(b);
    }
    return strip;
  }
}

export { $ };
