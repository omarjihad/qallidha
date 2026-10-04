// الحساب داخل اللعبة: اللفل والمايكات، المتجر واللبس، الرويال باس، الصندوق اليومي، ومكافآت نهاية اللعبة.
// كل شي هنا للاعبين تيليجرام (الضيف يلعب عادي بس ما يجمع).

import { ITEMS, ITEM, CUR, RARITY, PASS, passReward, levelProgress, isFree, ADS } from './catalog.js';
import { THEMES, portrait } from './stage.js';
import { $, el, toast, overlay } from './ui.js';
import { authBody } from './net.js';
import { haptic, tg as webApp } from './tg.js';
import { Ads } from './ads.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
// «+20» يبقى +20 حتى وسط جملة عربية (بدون عزل يطلع 20+)
const plus = (n) => `\u2066+${fmt(n)}\u2069`;

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
  ['mics', `${CUR.icon} ${CUR.name}`],
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
    toast('افتح اللعبة من تيليجرام حتى تجمع مايكات وتلعب الباس', 3500);
    return null;
  }

  /* ============================================================ الإعلانات بمكافأة */

  async watchAd(kind, item = null) {
    if (!this.tg) return this.tgOnly();
    if (!this.ads.rewarded) {
      toast('الإعلانات بعدها ما مفعّلة');
      return null;
    }
    const intent = await post('/api/ads/intent', { kind, item });
    if (!intent.ok) {
      toast(intent.error || intent.message || 'ما ينفع هسه', 3000);
      return null;
    }
    const shown = await this.ads.showRewarded();
    if (!shown.done) {
      if (shown.error && shown.error !== 'busy') toast(shown.error, 3000);
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
        toast(r.error, 3000);
        return null;
      }
      await sleep(900);
    }
    toast('المكافأة بالطريق — تنضاف لحسابك من توصل', 3500);
    return null;
  }

  announce(res) {
    if (!res) return;
    if (res.error) return toast(res.error, 3000);
    haptic('success');
    const it = res.item && ITEM.get(res.item);
    const passMsg = (p) => (p ? `🎖️ ${plus(p.xp)} خبرة باس${p.to > p.from ? ` — لفل ${p.to}!` : ''}` : '');
    switch (res.kind) {
      case 'coins':
      case 'double':
        return toast(`${CUR.icon} ${plus(res.mics)} ${CUR.one}`);
      case 'pass':
        return toast(passMsg(res.pass));
      case 'box':
        if (it) return toast(`🎁 طلعلك: ${it.icon} ${it.name}!`, 3500);
        if (res.pass) return toast('🎁 ' + passMsg(res.pass), 3500);
        return toast(`🎁 ${plus(res.mics)} ${CUR.one}`, 3000);
      case 'unlock':
        if (res.unlocked) return toast(`🔓 انفتح: ${it ? it.icon + ' ' + it.name : ''}!`, 3500);
        return toast(`🎬 ${res.n}/${res.need} — باقي ${res.need - res.n} ${res.need - res.n === 1 ? 'إعلان' : 'إعلانات'}`, 3000);
      case 'trial':
        return toast(`⏳ تكدر تلبس ${it ? it.name : 'الغرض'} 24 ساعة`, 3000);
      default:
    }
  }

  /* ============================================================ المتجر */

  async buy(id) {
    const it = ITEM.get(id);
    if (!this.tg) return this.tgOnly();
    if (this.profile.mics < it.price) {
      haptic('error');
      return toast(`ناقصك ${fmt(it.price - this.profile.mics)} ${CUR.one}`, 2500);
    }
    const r = await post('/api/shop/buy', { item: id });
    if (r.profile) this.set(r.profile);
    if (r.ok) {
      haptic('success');
      toast(`✅ صار عندك ${it.icon} ${it.name}`);
      await this.equip(it.type, id, true);
    } else toast(r.error || 'ما زبط', 2500);
  }

  async equip(slot, id, quiet = false) {
    if (!this.tg) return this.tgOnly();
    const r = await post('/api/shop/equip', { slot, item: id });
    if (r.profile) this.set(r.profile);
    if (!r.ok) toast(r.error || 'ما زبط', 2500);
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
        actions.push(el('div', { class: 'it-on' }, it.type === 'stage' ? '✓ مختار' : '✓ لابسه'));
        if (it.type === 'head' || it.type === 'face') actions.push(btn('شيل', 'ghost', () => this.equip(it.type, null)));
      } else actions.push(btn(it.type === 'stage' ? 'اختاره' : 'البسه', 'green', () => this.equip(it.type, it.id)));
      if (st.trial) actions.push(el('div', { class: 'it-note' }, `⏳ تجربة: باقي ${Math.max(1, Math.ceil((st.trial - Date.now()) / 3600000))} ساعة`));
    }
    if (!st.forever) {
      if (it.price != null) {
        const poor = !this.profile || this.profile.mics < it.price;
        actions.push(btn(`${CUR.icon} ${fmt(it.price)}`, 'buy' + (poor ? ' poor' : ''), () => this.buy(it.id)));
      }
      if (it.ads && this.ads.rewarded) actions.push(btn(`🎬 ${st.adN}/${it.ads}`, 'ad', () => this.watchAd('unlock', it.id)));
      if (it.price != null && !st.trial && this.ads.rewarded) actions.push(btn('جرّب 24س 🎬', 'try', () => this.watchAd('trial', it.id)));
      if (it.pass) {
        const src = PASS_SOURCE.get(it.id);
        actions.push(el('div', { class: 'it-note pass ' + it.pass }, `🎖️ الباس ${it.pass === 'premium' ? 'المميز' : 'المجاني'}${src ? ' — لفل ' + src.level : ''}`));
      }
    }
    return el(
      'div',
      { class: 'it-card' + (st.equipped ? ' equipped' : '') + (st.has ? ' has' : ''), style: { '--rar': rar.color } },
      el('div', { class: 'it-prev' }, this.preview(it), el('span', { class: 'it-rar' }, rar.name)),
      el('div', { class: 'it-name' }, it.name),
      el('div', { class: 'it-acts' }, actions),
    );
  }

  micsTab() {
    const p = this.profile;
    const cards = [];
    const card = (icon, title, sub, button) => el('div', { class: 'earn-card' }, el('div', { class: 'earn-ic' }, icon), el('div', { class: 'earn-t' }, title), el('div', { class: 'earn-s' }, sub), button);
    const adBtn = (label, ok, fn) => el('button', { class: 'it-btn ad' + (ok ? '' : ' poor'), onclick: fn }, label);
    if (!this.ads.rewarded) cards.push(card('🎬', 'الإعلانات بعدها ما مفعّلة', 'العب وجمّع مايكات من كل لعبة', null));
    else {
      cards.push(card(CUR.icon, `${plus(ADS.coins.mics)} ${CUR.one}`, `باقي ${p.daily.coins} من ${ADS.coins.perDay} اليوم`, adBtn('🎬 شاهد', p.daily.coins > 0, () => this.watchAd('coins'))));
      cards.push(card('🎁', 'صندوق اليوم', p.daily.box > 0 ? 'مايكات أو إكسسوار أو خبرة باس' : 'فتحته اليوم — ارجع باچر', adBtn('🎬 افتح', p.daily.box > 0, () => this.watchAd('box'))));
      if (p.lastGame && p.lastGame.canDouble)
        cards.push(card('✖️2', 'ضاعف آخر لعبة', `${plus(p.lastGame.mics)} ${CUR.one}`, adBtn('🎬 ضاعف', true, () => this.watchAd('double'))));
    }
    cards.push(card('🎮', 'العب', `كل لعبة تنطيك ${CUR.name} حسب نقاطك، والفائز ويا ربعه +15، وكل لفل جديد مكافأة`, null));
    return el('div', { class: 'earn-grid' }, cards);
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
        el('button', { class: 'xbtn', onclick: close }, '✕'),
        el(
          'div',
          { class: 'shop-head' },
          el('div', { class: 'panel-title' }, '🛒 المتجر'),
          el('div', { class: 'mics-pill' }, `${CUR.icon} ${fmt(p.mics)}`),
        ),
        el(
          'div',
          { class: 'tabs' },
          TABS.map(([k, label]) => el('button', { class: 'tab' + (k === cur ? ' on' : ''), onclick: () => ((cur = k), (scroller = null), render()) }, label)),
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
      el('div', { class: 'rp-lb' }, it ? it.name : `${plus(r.mics)}`),
      locked ? el('div', { class: 'rp-lock' }, '🔒') : reached ? el('div', { class: 'rp-ok' }, '✓') : null,
    );
  }

  async buyPass() {
    if (!this.tg) return this.tgOnly();
    const r = await post('/api/pass/invoice');
    if (!r.ok) return toast(r.error || 'ما زبطت الفاتورة', 3000);
    if (!webApp || !webApp.openInvoice) return toast('افتح البوت واكتب /pass حتى تدفع', 3500);
    webApp.openInvoice(r.link, async (status) => {
      if (status === 'paid') {
        toast('🎉 تم الدفع! جاري التفعيل…', 2500);
        for (let i = 0; i < 10; i++) {
          await sleep(1200);
          const me = await this.refresh();
          if (me.profile && me.profile.pass.premium) {
            haptic('success');
            toast('🎖️ تفعّل الرويال باس المميز!', 3500);
            return;
          }
        }
      } else if (status === 'failed') toast('ما تم الدفع', 2500);
    });
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
      track = el('div', { class: 'rp-track' }, el('div', { class: 'rp-rows' }, el('div', { class: 'rp-tag free' }, 'مجاني'), el('div', { class: 'rp-tag prem' }, '⭐ مميز')), cols);
      const adLeft = p.daily.pass;
      const panel = el(
        'div',
        { class: 'panel pass' },
        el('button', { class: 'xbtn', onclick: close }, '✕'),
        el(
          'div',
          { class: 'pass-head' },
          el('div', {}, el('div', { class: 'panel-title' }, `🎖️ الرويال باس — الموسم ${ps.season}`), el('div', { class: 'hint' }, `باقي ${days} يوم · كل ${PASS.xpPerLevel} خبرة = لفل · نقاطك باللعب = خبرة`)),
          ps.premium
            ? el('div', { class: 'prem-badge' }, '⭐ مميز — 100 لفل')
            : el('button', { class: 'btn gold', onclick: () => this.buyPass() }, `⭐ ${this.config.passPrice || 99} — افتح 100 لفل`),
        ),
        el(
          'div',
          { class: 'pass-prog' },
          el('div', { class: 'pass-lv' }, el('small', {}, 'لفل'), el('b', {}, String(ps.level)), el('small', {}, `من ${ps.cap}`)),
          el(
            'div',
            { class: 'pass-bar' },
            el('i', { style: { width: `${Math.round((inLevel / PASS.xpPerLevel) * 100)}%` } }),
            el('span', {}, ps.level >= ps.cap ? (ps.premium ? 'خلصت الباس 🎉' : 'وصلت 50 — المميز يفتح لحد 100') : `${inLevel} / ${PASS.xpPerLevel} خبرة`),
          ),
          this.ads.rewarded
            ? el('button', { class: 'it-btn ad' + (adLeft > 0 ? '' : ' poor'), onclick: () => this.watchAd('pass') }, `🎬 ${plus(PASS.adXp)} خبرة (${adLeft})`)
            : null,
        ),
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
  chip(user) {
    const name = (user && user.name) || '';
    const photo = user && user.photo;
    const p = this.profile;
    const lp = p ? p.level : levelProgress(0);
    return el(
      'div',
      { class: 'profile-chip' },
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
          : el('small', {}, 'ضيف — افتح من تيليجرام حتى تجمع'),
      ),
    );
  }

  /** مكافآت نهاية اللعبة (لي أنا) */
  rewardsStrip(reward) {
    if (!reward) return null;
    const micsB = el('b', {}, plus(reward.mics));
    const items = [el('div', { class: 'rw' }, micsB, el('span', {}, `${CUR.icon} ${CUR.name}`))];
    if (reward.lvTo > reward.lvFrom) items.push(el('div', { class: 'rw up' }, el('b', {}, `⭐ ${reward.lvFrom} ← ${reward.lvTo}`), el('span', {}, `لفل جديد ${plus(reward.levelMics)} ${CUR.icon}`)));
    if (reward.pass) {
      const p = reward.pass;
      items.push(el('div', { class: 'rw' }, el('b', {}, `${plus(p.xp)}`), el('span', {}, p.to > p.from ? `🎖️ باس لفل ${p.to}!` : '🎖️ خبرة باس')));
      for (const r of (p.rewards || []).filter((x) => x.item)) {
        const it = ITEM.get(r.item);
        if (it) items.push(el('div', { class: 'rw up' }, el('b', {}, it.icon), el('span', {}, r.dup ? `${it.name} (${plus(r.dup)} ${CUR.icon})` : it.name)));
      }
    }
    const can = this.ads.rewarded && this.profile && this.profile.lastGame && this.profile.lastGame.canDouble && this.profile.lastGame.gkey === reward.gkey;
    const strip = el('div', { class: 'rewards' }, el('div', { class: 'rw-title' }, '🎁 مكافآتك'), el('div', { class: 'rw-items' }, items));
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
              micsB.textContent = `\u2066+${fmt(reward.mics + (r.mics || reward.mics))} ×2\u2069`;
              micsB.parentElement.classList.add('up');
            } else b.disabled = false;
          },
        },
        `🎬 ضاعف ${CUR.name}ك (${plus(reward.mics)})`,
      );
      strip.appendChild(b);
    }
    return strip;
  }
}

export { $ };
