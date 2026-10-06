// لوحة المطوّر داخل اللعبة 🛠️ — تبين للأدمن بس، والسيرفر يتأكد من كل طلب (initData موقّعة + ADMIN_IDS).
// طبقة طولية برا اللعبة المدوّرة حتى الكتابة والكيبورد يشتغلون طبيعي.
// بيها كل أوامر البوت + مسابقة المتصدرين + الهدايا (مايكات، لفل، سكنات، رويال باس).

import { el } from './ui.js';
import { authBody } from './net.js';
import { haptic, backButton, openTgLink, tg as webApp, onViewportChange } from './tg.js';
import { ITEMS, ITEM, RARITY, STAR_PACK, MAX_LEVEL, PASS, CUR, seasonOf } from './catalog.js';
import { fmtLeft, MEDALS, CONTEST_PRIZES, CONTEST_DAYS } from './contest.js';
import { VERSION } from './shared.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const TZ = 'Asia/Baghdad';

/** ستايل اللوحة ينحمّل بس للأدمن (أول مرة تنفتح) */
let cssReady = null;
function loadCss() {
  if (!cssReady) {
    cssReady = new Promise((resolve) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = `/css/admin.css?v=${VERSION}`;
      l.onload = () => resolve(true);
      l.onerror = () => resolve(false);
      document.head.appendChild(l);
      setTimeout(() => resolve(false), 4000);
    });
  }
  return cssReady;
}

/** المساحات الآمنة الحقيقية (اللوحة طولية وما تندار ويا اللعبة، فناخذها من تيليجرام مباشرة) */
function syncSafe(node) {
  const o = (webApp && webApp.safeAreaInset) || null;
  const c = (webApp && webApp.contentSafeAreaInset) || null;
  if (!o && !c) return;
  for (const [side, k] of [
    ['top', 'st'],
    ['bottom', 'sb'],
    ['left', 'sl'],
    ['right', 'sr'],
  ]) {
    const v = Math.max(0, (o && o[side]) || 0) + Math.max(0, (c && c[side]) || 0);
    node.style.setProperty('--adm-' + k, `${v}px`);
  }
}

/** «06/10 23:33» بتوقيت بغداد (معزول LTR حتى ما يتلخبط بالعربي) */
function when(ts) {
  if (!ts) return '—';
  let s;
  try {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(ts))
        .map((x) => [x.type, x.value]),
    );
    s = `${p.day}/${p.month} ${p.hour}:${p.minute}`;
  } catch {
    s = new Date(ts).toISOString().slice(5, 16).replace('T', ' ');
  }
  return '\u2066' + s + '\u2069';
}

function ago(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'هسه';
  if (s < 3600) return `قبل ${Math.round(s / 60)} دقيقة`;
  if (s < 86400) return `قبل ${Math.round(s / 3600)} ساعة`;
  return `قبل ${Math.round(s / 86400)} يوم`;
}

/** طلب للوحة. يرمي خطأ برسالة السيرفر */
async function call(op, args = {}) {
  let res;
  try {
    res = await fetch('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...authBody(), op, ...args }) });
  } catch {
    throw new Error('ماكو اتصال');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.message || data.error || 'صار خطأ');
  return data;
}

function packName(sku, qty) {
  if (!sku || sku === 'pass') return 'رويال باس مميز';
  const p = STAR_PACK.get(sku);
  if (!p) return sku;
  if (p.kind === 'mics') return `${fmt(qty || p.mics)} مايك`;
  if (p.kind === 'levels') return `${qty || p.levels} لفل باس`;
  return 'مميز + 10 لفلات';
}

const TABS = [
  ['dash', '📊', 'الرئيسية'],
  ['contest', '🏆', 'المسابقة'],
  ['users', '🎁', 'اللاعبين والهدايا'],
  ['bc', '📢', 'الإذاعة'],
  ['subs', '🎙️', 'المقترحة'],
  ['sounds', '🎵', 'الأصوات'],
  ['ban', '🚫', 'الحظر'],
  ['pay', '💰', 'المدفوعات'],
  ['set', '⚙️', 'الإعدادات'],
];

let current = null;

export function adminOpen() {
  return !!current;
}

/** يفتح اللوحة. tab: التبويب الأول */
export function openAdmin({ meta = null, tab = 'dash', onClose = null } = {}) {
  if (current) current.close(true);
  const S = { tab, user: null, q: '', soundFilter: 'all', soundQ: '', sel: new Set(), notify: true, contest: null, closed: false };
  let ticker = null;
  let poll = null;

  const toastEl = el('div', { class: 'adm-toast' });
  let toastT = null;
  const toast = (m, ms = 2600) => {
    toastEl.textContent = m;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), ms);
  };

  const body = el('main', { class: 'adm-body' });
  const tabsBar = el('nav', { class: 'adm-tabs' });
  const root = el(
    'div',
    { class: 'adm', dir: 'rtl', lang: 'ar' },
    el(
      'header',
      { class: 'adm-head' },
      el('button', { class: 'adm-ic', 'aria-label': 'سكّر', onclick: () => close() }, '✕'),
      el('div', { class: 'adm-title' }, '🛠️ لوحة المطوّر', el('small', {}, `قلّدها v${VERSION}`)),
      el('button', { class: 'adm-ic', 'aria-label': 'تحديث', onclick: () => show(S.tab) }, '🔄'),
    ),
    tabsBar,
    body,
    toastEl,
  );

  /* ---------------- حوارات داخل اللوحة */
  function modal(content) {
    const layer = el('div', { class: 'adm-modal' }, el('div', { class: 'adm-dlg' }, content));
    // دوسة برا الحوار = إلغاء
    layer.addEventListener('click', (e) => e.target === layer && layer.cancel && layer.cancel());
    root.appendChild(layer);
    return layer;
  }

  function askConfirm(text, yes = 'إي', danger = false) {
    return new Promise((resolve) => {
      const done = (v) => {
        layer.remove();
        resolve(v);
      };
      const layer = modal([
        el('div', { class: 'adm-dlg-t' }, text),
        el(
          'div',
          { class: 'adm-row end' },
          el('button', { class: 'abtn ghost', onclick: () => done(false) }, 'لا، رجوع'),
          el('button', { class: 'abtn ' + (danger ? 'red' : 'pink'), onclick: () => done(true) }, yes),
        ),
      ]);
      layer.cancel = () => done(false);
    });
  }

  function askText(title, { placeholder = '', value = '', multiline = false, yes = 'تمام', allowEmpty = false } = {}) {
    return new Promise((resolve) => {
      const input = multiline
        ? el('textarea', { class: 'ainput', rows: '4', placeholder })
        : el('input', { class: 'ainput', placeholder, value });
      if (multiline) input.value = value;
      const done = (v) => {
        layer.remove();
        resolve(v);
      };
      const layer = modal([
        el('div', { class: 'adm-dlg-t' }, title),
        input,
        el(
          'div',
          { class: 'adm-row end' },
          el('button', { class: 'abtn ghost', onclick: () => done(null) }, 'إلغاء'),
          el(
            'button',
            {
              class: 'abtn pink',
              onclick: () => {
                const v = input.value.trim();
                if (!v && !allowEmpty) return input.focus();
                done(v);
              },
            },
            yes,
          ),
        ),
      ]);
      layer.cancel = () => done(null);
      setTimeout(() => input.focus(), 60);
    });
  }

  /** زر ينفّذ طلب: يتعطّل لحد ما يخلص، ويطلع خطأ إذا صار */
  async function run(btn, fn, okMsg = '') {
    if (btn) btn.disabled = true;
    try {
      const r = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      haptic('success');
      return r;
    } catch (e) {
      haptic('error');
      toast('❌ ' + (e.message || 'صار خطأ'), 3500);
      return null;
    } finally {
      if (btn && btn.isConnected) btn.disabled = false;
    }
  }

  const B = (label, cls, onclick, attrs = {}) => {
    const b = el('button', { class: 'abtn ' + (cls || ''), ...attrs, onclick: (e) => onclick(b, e) }, label);
    return b;
  };
  const card = (...c) => el('section', { class: 'acard' }, ...c);
  const h = (t, extra = null) => el('div', { class: 'acard-h' }, el('b', {}, t), extra);
  const stat = (ic, label, value, sub = '') => el('div', { class: 'astat' }, el('span', { class: 'astat-ic' }, ic), el('b', {}, value), el('small', {}, label), sub ? el('em', {}, sub) : null);
  const loading = () => el('div', { class: 'aempty' }, '⏳ جاري التحميل…');
  const empty = (t) => el('div', { class: 'aempty' }, t);
  const left = (end) => el('b', { class: 'aleft', 'data-end': String(end) }, fmtLeft(end - Date.now()));
  const avatar = (u, cls = '') =>
    u && u.photo ? el('img', { class: 'aav ' + cls, src: u.photo, alt: '' }) : el('span', { class: 'aav ph ' + cls }, String((u && u.name) || '؟').trim().slice(0, 1) || '؟');
  const idOf = (uid) => String(uid || '').replace(/^t/, '');

  function copy(text) {
    try {
      navigator.clipboard.writeText(String(text));
      toast('📋 انسخ: ' + text);
    } catch {
      toast(String(text));
    }
  }

  /* ---------------- التبويبات */
  function drawTabs() {
    tabsBar.innerHTML = '';
    for (const [k, ic, label] of TABS) {
      tabsBar.appendChild(el('button', { class: 'atab' + (k === S.tab ? ' on' : ''), onclick: () => show(k) }, el('span', {}, ic), label));
    }
    const on = tabsBar.querySelector('.atab.on');
    if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function mount(...nodes) {
    body.innerHTML = '';
    for (const n of nodes.flat()) if (n) body.appendChild(n);
  }

  /**
   * يرسم تبويب. نفس التبويب (تحديث) يبقى بنفس مكان التمرير، وغيره يبدي من فوك.
   * كل رسمة إلها رقم: إذا وصل جواب طلب قديم بعد ما انتقلت لتبويب ثاني (أو سكّرت اللوحة) ينهمل.
   */
  let seq = 0;
  async function show(tab, { top = false } = {}) {
    if (S.closed) return;
    const keep = !top && S.tab === tab ? body.scrollTop : 0;
    const my = ++seq;
    const live = () => !S.closed && my === seq;
    const v = {
      mount: (...nodes) => live() && mount(...nodes),
      every: (ms, t) => live() && every(ms, t),
    };
    S.tab = tab;
    clearInterval(poll);
    drawTabs();
    const fn = VIEWS[tab] || VIEWS.dash;
    if (!body.firstChild || !keep) mount(loading());
    try {
      await fn(v);
    } catch (e) {
      v.mount(card(empty('❌ ' + (e.message || 'صار خطأ'))), el('div', { class: 'adm-row center' }, B('🔄 جرّب مرة ثانية', 'pink', () => show(tab))));
    }
    if (live()) body.scrollTop = keep;
  }

  /** يحدّث التبويب كل شوية (مثلًا وقت الإذاعة) */
  function every(ms, tab) {
    clearInterval(poll);
    poll = setInterval(() => {
      if (S.tab === tab && !root.querySelector('.adm-modal') && document.activeElement && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) show(tab);
    }, ms);
  }

  /* ---------------- الإذاعة (حالة مختصرة) */
  function bcBox(bc, reach) {
    if (!bc) return null;
    const pct = bc.total ? Math.round(((bc.sent + bc.failed) / bc.total) * 100) : 0;
    const label = bc.kind === 'contest' ? { start: '🔥 إذاعة بداية المسابقة', remind: '⏰ إذاعة تذكير المسابقة', winners: '🏁 إذاعة الفائزين' }[bc.tpl] || '📢 إذاعة' : '📢 إذاعة شغّالة';
    return card(
      h(label, el('span', { class: 'abadge live' }, 'شغّالة')),
      el('div', { class: 'abar' }, el('i', { style: { width: pct + '%' } })),
      el('div', { class: 'adm-row between' }, el('span', {}, `✅ ${fmt(bc.sent)} من ${fmt(bc.total || reach)} · ❌ ${fmt(bc.failed)}`), el('small', { class: 'dim' }, ago(bc.started))),
      el(
        'div',
        { class: 'adm-row end' },
        B('⏹️ وقّف الإذاعة', 'red sm', async (b) => {
          if (!(await askConfirm('توقّف الإذاعة؟ اللي وصلتهم وصلتهم، والباقين ما توصلهم.', 'إي، وقّفها', true))) return;
          await run(b, () => call('bc.stop'), '⏹️ وقفت الإذاعة');
          show(S.tab);
        }),
      ),
    );
  }

  /* ================================================================ الشاشات */
  const VIEWS = {
    /* ---------------- 📊 الرئيسية */
    async dash(v) {
      const { stats: s, contest: cs } = await call('dash');
      const c = cs.contest;
      const running = c && c.status === 'running';
      v.mount(
        el(
          'div',
          { class: 'agrid' },
          stat('👥', 'كل اللاعبين', fmt(s.users), `توصلهم الإذاعة: ${fmt(s.reach)}`),
          stat('🆕', 'جدد اليوم', fmt(s.new24), `الأسبوع: ${fmt(s.new7)}`),
          stat('🟢', 'نشطين اليوم', fmt(s.active24), `لعبوا ولو مرة: ${fmt(s.players)}`),
          stat('🎮', 'ألعاب اليوم', fmt(s.gamesToday), `الكلي: ${fmt(s.gamesTotal)}`),
          stat('⭐', 'النجوم', fmt(s.stars), `آخر 24 ساعة: ${fmt(s.stars24)}`),
          stat('🎲', 'الغرف العامة', fmt(s.rooms && s.rooms.rooms), `ينتظرون: ${fmt(s.rooms && s.rooms.waiting)}`),
          stat('🎵', 'الأصوات الفعّالة', fmt(s.sounds), `المكتبة ${fmt(s.library)} · المضافة ${fmt(s.custom)}`),
          stat('🎙️', 'مقترحة تنتظر', fmt(s.subsPending)),
        ),
        bcBox(s.bc, s.reach),
        card(
          h('🏆 مسابقة المتصدرين', running ? el('span', { class: 'abadge live' }, 'شغّالة') : el('span', { class: 'abadge' }, c && c.status === 'ended' ? 'خلصت' : 'ماكو')),
          running
            ? el('div', { class: 'acontest-mini' }, el('span', {}, '⏳ تبقى'), left(c.end), el('small', {}, `#${c.id} · ${cs.players.n} لاعب بالمسابقة`))
            : el('div', { class: 'dim' }, 'ابدي مسابقة أسبوعية: أول 3 بالمتصدرين ياخذون نجوم تيليجرام'),
          el('div', { class: 'adm-row end' }, B(running ? '🏆 شوف المسابقة' : '📢 ابدأ مسابقة', 'gold', () => show('contest'))),
        ),
        s.subsPending ? card(h(`🎙️ ${s.subsPending} صوت مقترح ينتظرك`), el('div', { class: 'adm-row end' }, B('▶️ راجعها', 'pink', () => show('subs')))) : null,
        card(
          h('⚡ سريع'),
          toggleRow('🛠️ وضع الصيانة', s.maint ? 'شغّال — اللاعبين ما يكدرون يلعبون (إنت تكدر)' : 'مطفي', s.maint, async (on, b) => {
            if (on && !(await askConfirm('تشغّل الصيانة؟ اللعبة والبوت يوقفون للاعبين لحد ما تطفيها.', 'شغّلها', true))) return false;
            return run(b, () => call('maint', { on }), on ? '🛠️ الصيانة شغّالة' : '✅ طفت الصيانة');
          }),
          toggleRow('🔔 إشعار كل لاعب جديد', s.notify ? 'شغّال — يوصلك بالبوت' : 'مطفي', s.notify, (on, b) => run(b, () => call('notify', { on }), on ? '🔔 شغّال' : '🔕 مطفي')),
        ),
      );
      if (s.bc || running) v.every(s.bc ? 3000 : 30000, 'dash');
    },

    /* ---------------- 🏆 المسابقة */
    async contest(v) {
      const d = await call('contest');
      S.contest = d;
      const c = d.contest;
      const running = c && c.status === 'running';
      const nodes = [];
      nodes.push(bcBox(d.bc, d.reach));
      if (running) {
        const prizeIn = c.prizes.map((p, i) => el('input', { class: 'ainput num', type: 'number', min: '0', inputmode: 'numeric', value: String(p), 'aria-label': `جائزة ${i + 1}` }));
        nodes.push(
          card(
            h(`🔥 المسابقة #${c.id} شغّالة`, el('span', { class: 'abadge live' }, 'LIVE')),
            el('div', { class: 'acountdown' }, el('small', {}, '⏳ تبقى على انتهاء المسابقة'), left(c.end)),
            el(
              'div',
              { class: 'akv' },
              el('span', {}, '🟢 بدت'),
              el('b', {}, when(c.start)),
              el('span', {}, '🏁 تنتهي'),
              el('b', {}, when(c.end)),
              el('span', {}, '👥 بالمسابقة'),
              el('b', {}, `${fmt(d.players.n)} لاعب · ${fmt(d.players.g)} لعبة`),
              el('span', {}, '📢 انذاعت'),
              el('b', {}, c.pubs ? `${c.pubs} مرة · آخر وحدة ${ago(c.lastPub)}` : 'بعد ما انذاعت'),
            ),
            el(
              'div',
              { class: 'adm-row wrap' },
              B('📢 نشر (تذكير بالوقت المتبقي)', 'gold big', async (b) => {
                const pv = await run(b, () => call('contest.preview'));
                if (!pv) return;
                if (pv.tpl !== 'remind') {
                  toast('المسابقة خلصت — حدّثت اللوحة');
                  return show('contest');
                }
                if (!(await askConfirm(el('div', {}, el('div', {}, `راح توصل لـ${fmt(d.reach)} لاعب (كل واحد بلغته):`), el('pre', { class: 'apreview' }, pv.text)), '📢 انشرها'))) return;
                await run(b, () => call('contest.publish', { expect: 'remind', cid: c.id }), (x) => `📢 بدت الإذاعة لـ${fmt(x.total)} لاعب`);
                show('contest');
              }),
            ),
          ),
          card(
            h('🎁 الجوائز (نجوم تيليجرام)'),
            el('div', { class: 'aprizes' }, prizeIn.map((inp, i) => el('label', {}, el('span', {}, MEDALS[i]), inp, el('em', {}, '⭐')))),
            el(
              'div',
              { class: 'adm-row end' },
              B('💾 احفظ الجوائز', 'pink sm', async (b) => {
                const prizes = prizeIn.map((x) => Number(x.value) || 0);
                if (await run(b, () => call('contest.edit', { prizes }), '✅ تغيّرت الجوائز')) show('contest');
              }),
            ),
          ),
          card(
            h('⏱️ الوقت'),
            el(
              'div',
              { class: 'adm-row wrap' },
              B('➕ يوم', 'ghost sm', async (b) => (await run(b, () => call('contest.edit', { end: c.end + 86400000 }), '✅ انضاف يوم')) && show('contest')),
              B('➕ ساعة', 'ghost sm', async (b) => (await run(b, () => call('contest.edit', { end: c.end + 3600000 }), '✅ انضافت ساعة')) && show('contest')),
              B('➖ يوم', 'ghost sm', async (b) => (await run(b, () => call('contest.edit', { end: c.end - 86400000 }), '✅ نقص يوم')) && show('contest')),
            ),
            el(
              'div',
              { class: 'adm-row wrap' },
              B('🏁 إنهاء هسه', 'red sm', async (b) => {
                if (!(await askConfirm('تنهي المسابقة هسه؟ الفائزين = أول 3 بالترتيب الحالي، ويوصلهم إشعار.', 'إي، أنهيها', true))) return;
                if (await run(b, () => call('contest.end'), '🏁 خلصت المسابقة')) show('contest');
              }),
              B('✖️ إلغاء بدون فائزين', 'red ghost sm', async (b) => {
                if (!(await askConfirm('تلغي المسابقة بدون فائزين؟ (النقاط تبقى بس ماكو جوائز)', 'إي، ألغيها', true))) return;
                if (await run(b, () => call('contest.cancel'), '✖️ انلغت المسابقة')) show('contest');
              }),
            ),
          ),
        );
      } else {
        // ماكو مسابقة: نبديها
        const days = el('input', { class: 'ainput num', type: 'number', min: '1', max: '60', step: '1', inputmode: 'numeric', value: String(CONTEST_DAYS) });
        const prizeIn = (d.defaults.prizes || CONTEST_PRIZES).map((p, i) => el('input', { class: 'ainput num', type: 'number', min: '0', inputmode: 'numeric', value: String(p), 'aria-label': `جائزة ${i + 1}` }));
        const pv = el('pre', { class: 'apreview' }, d.preview && d.preview.text);
        const refresh = async () => {
          const r = await call('contest.preview', { days: Number(days.value) || CONTEST_DAYS, prizes: prizeIn.map((x) => Number(x.value) || 0) }).catch(() => null);
          if (r) pv.textContent = r.text;
        };
        for (const i of [days, ...prizeIn]) i.addEventListener('change', refresh);
        nodes.push(
          card(
            h('🔥 مسابقة جديدة للمتصدرين'),
            el('div', { class: 'dim' }, 'أول 3 بالترتيب يربحون نجوم تيليجرام. النقاط تنحسب من الألعاب اللي بيها لاعبين تيليجرام اثنين أو أكثر (اللعب وحدك ما ينحسب).'),
            el('div', { class: 'aprizes' }, prizeIn.map((inp, i) => el('label', {}, el('span', {}, MEDALS[i]), inp, el('em', {}, '⭐')))),
            el('label', { class: 'afield' }, el('span', {}, '⏳ المدة (أيام)'), days),
            el('div', { class: 'acard-h' }, el('b', {}, '👁️ الرسالة اللي توصل للاعبين')),
            pv,
            el(
              'div',
              { class: 'adm-row wrap' },
              B('📢 انشر وابدي المسابقة', 'gold big', async (b) => {
                if (!(await askConfirm(`تبدي المسابقة وتوصل الرسالة لـ${fmt(d.reach)} لاعب (كل واحد بلغته)؟`, '📢 ابديها وانشرها'))) return;
                const r = await run(
                  b,
                  () => call('contest.publish', { expect: 'start', days: Number(days.value) || CONTEST_DAYS, prizes: prizeIn.map((x) => Number(x.value) || 0) }),
                  (x) => `🔥 بدت المسابقة — الإذاعة لـ${fmt(x.total)} لاعب`,
                );
                // خطأ؟ نخلي الأرقام اللي كتبها (الرسالة تكول شنو صار)
                if (r) show('contest');
              }),
              B('▶️ ابديها بدون إذاعة', 'ghost', async (b) => {
                const r = await run(
                  b,
                  () => call('contest.publish', { expect: 'start', silent: true, days: Number(days.value) || CONTEST_DAYS, prizes: prizeIn.map((x) => Number(x.value) || 0) }),
                  '🔥 بدت المسابقة (بدون إذاعة)',
                );
                if (r) show('contest');
              }),
            ),
          ),
        );
      }
      // المتصدرين هسه
      if (c && d.top.length) {
        nodes.push(
          card(
            h(running ? '🏆 الترتيب هسه' : `🏆 ترتيب المسابقة #${c.id}`),
            el(
              'div',
              { class: 'alist' },
              d.top.map((r, i) =>
                el(
                  'button',
                  { class: 'arow', onclick: () => openUser(r.uid) },
                  el('span', { class: 'arank' }, MEDALS[i] || String(i + 1)),
                  avatar(r),
                  el('div', { class: 'agrow' }, el('b', {}, r.name || 'لاعب'), el('small', {}, `${r.username ? '@' + r.username + ' · ' : ''}${fmt(r.games)} لعبة · ${fmt(r.wins)} فوز`)),
                  el('b', { class: 'apts' }, fmt(r.points)),
                  running && c.prizes[i] ? el('span', { class: 'aprize' }, `${fmt(c.prizes[i])}⭐`) : null,
                ),
              ),
            ),
          ),
        );
      } else if (running) nodes.push(card(h('🏆 الترتيب هسه'), empty('بعد ماكو أحد — أول لعبة ويا لاعبين ثانيين تبين هنا')));
      // الفائزين (آخر مسابقة خلصت)
      const last = c && c.status === 'ended' ? c : (d.hist || []).find((x) => x.status === 'ended');
      if (last) nodes.push(winnersCard(last, d));
      // السجل
      const hist = (d.hist || []).filter((x) => !last || x.id !== last.id);
      if (hist.length) {
        nodes.push(
          card(
            h('🗂️ المسابقات السابقة'),
            el(
              'div',
              { class: 'alist' },
              hist.map((x) =>
                el(
                  'div',
                  { class: 'arow' },
                  el('span', { class: 'arank' }, `#${x.id}`),
                  el('div', { class: 'agrow' }, el('b', {}, x.status === 'cancelled' ? '✖️ انلغت' : `🏁 خلصت ${when(x.endedAt || x.end)}`), el('small', {}, (x.winners || []).map((w) => `${MEDALS[w.rank - 1]} ${w.name}${w.paid ? ' ✅' : ''}`).join('  ') || '—')),
                ),
              ),
            ),
          ),
        );
      }
      v.mount(nodes);
      if (d.bc) v.every(3000, 'contest');
    },

    /* ---------------- 🎁 اللاعبين والهدايا */
    async users(v) {
      if (S.user) return userView(S.user, v);
      const q = el('input', { class: 'ainput', type: 'search', placeholder: 'آيدي، @يوزر، أو اسم…', value: S.q, enterkeyhint: 'search' });
      const list = el('div', { class: 'alist' }, loading());
      const search = async () => {
        S.q = q.value.trim();
        list.innerHTML = '';
        list.appendChild(loading());
        try {
          const { users } = await call('users', { q: S.q });
          list.innerHTML = '';
          if (!users.length) list.appendChild(empty('ما لگيت أحد 🤷'));
          for (const u of users) {
            list.appendChild(
              el(
                'button',
                { class: 'arow', onclick: () => openUser(u.uid) },
                avatar(u),
                el('div', { class: 'agrow' }, el('b', {}, u.name || 'لاعب', u.banned ? ' 🚫' : ''), el('small', {}, `${u.username ? '@' + u.username + ' · ' : ''}${idOf(u.uid)} · ${ago(u.seen)}`)),
                el('span', { class: 'alv' }, `⭐${u.level}`),
                el('small', { class: 'amics' }, `${CUR.icon}${fmt(u.mics)}`),
              ),
            );
          }
        } catch (e) {
          list.innerHTML = '';
          list.appendChild(empty('❌ ' + e.message));
        }
      };
      q.addEventListener('keydown', (e) => e.key === 'Enter' && search());
      const gifts = el('div', { class: 'alist' });
      v.mount(
        card(h('🔎 دوّر على لاعب'), el('div', { class: 'adm-row' }, q, B('بحث', 'pink', search)), el('small', { class: 'dim' }, 'بدون بحث: آخر اللاعبين اللي دخلوا')),
        card(h('👥 اللاعبين'), list),
        card(h('🎁 آخر الهدايا'), gifts),
      );
      search();
      call('gifts')
        .then(({ gifts: g }) => {
          if (!g.length) return gifts.appendChild(empty('بعد ما اهديت أحد'));
          for (const x of g) gifts.appendChild(el('button', { class: 'arow', onclick: () => openUser(x.uid) }, el('div', { class: 'agrow' }, el('b', {}, x.name || idOf(x.uid)), el('small', {}, `${giftLabel(x)} · ${ago(x.at)}${x.seen ? ' · 👁️ شافها' : ''}`))));
        })
        .catch(() => null);
    },

    /* ---------------- 📢 الإذاعة */
    async bc(v) {
      const st = await call('bc.status');
      const text = el('textarea', { class: 'ainput', rows: '7', placeholder: 'اكتب الرسالة اللي توصل لكل اللاعبين…' });
      text.value = S.bcDraft || '';
      text.addEventListener('input', () => (S.bcDraft = text.value));
      const btnRow = el('input', { type: 'checkbox', checked: true });
      v.mount(
        bcBox(st.bc, st.reach),
        card(
          h('📢 رسالة لكل اللاعبين', el('span', { class: 'abadge' }, `${fmt(st.reach)} لاعب`)),
          text,
          el('label', { class: 'acheck' }, btnRow, el('span', {}, 'زر «🎮 العب هسه» تحت الرسالة (بلغة كل لاعب)')),
          el(
            'div',
            { class: 'adm-row end' },
            B('📢 أرسلها', 'pink big', async (b) => {
              const t = text.value.trim();
              if (t.length < 2) return toast('اكتب الرسالة أول');
              if (!(await askConfirm(el('div', {}, el('div', {}, `توصل لـ${fmt(st.reach)} لاعب كما هي:`), el('pre', { class: 'apreview' }, t)), '📢 أرسل'))) return;
              const r = await run(b, () => call('bc', { text: t, button: btnRow.checked }), (x) => `📢 بدت الإذاعة لـ${fmt(x.total)} لاعب`);
              if (r) {
                S.bcDraft = '';
                show('bc');
              }
            }),
          ),
          el('small', { class: 'dim' }, '🖼️ صورة أو فيديو أو فويس؟ دزها للبوت من /admin ← 📢 إذاعة وتوصل كما هي.'),
        ),
      );
      if (st.bc) v.every(3000, 'bc');
    },

    /* ---------------- 🎙️ المقترحة */
    async subs(v) {
      const { subs } = await call('subs');
      if (!subs.length) return v.mount(card(h('🎙️ الأصوات المقترحة'), empty('✅ ماكو أصوات تنتظر')));
      v.mount(
        subs.map((s) => {
          const isVideo = /video/.test(s.media);
          const player = isVideo ? el('video', { class: 'aplayer v', src: s.url, controls: true, playsinline: true, preload: 'none' }) : el('audio', { class: 'aplayer', src: s.url, controls: true, preload: 'none' });
          return card(
            h(`#${s.id} «${s.title}»`, el('span', { class: 'abadge' }, s.dur ? `${s.dur} ث` : '؟')),
            el('div', { class: 'dim' }, `👤 ${s.name || 'لاعب'}${s.username ? ' · @' + s.username : ''} · ${idOf(s.uid)} · ${ago(s.created)}`),
            player,
            el(
              'div',
              { class: 'adm-row end' },
              B('❌ رفض', 'red ghost', async (b) => {
                const reason = await askText(`سبب رفض «${s.title}» (يوصل للاعب) — تكدر تخليه فارغ`, { placeholder: 'السبب…', allowEmpty: true, yes: 'ارفضه' });
                if (reason === null) return;
                if (await run(b, () => call('sub.no', { id: s.id, reason }), '❌ انرفض ووصل للاعب')) show('subs');
              }),
              B('✅ قبول (+50 🎤)', 'green', async (b) => {
                if (await run(b, () => call('sub.ok', { id: s.id }), (r) => `✅ انضاف للعبة (صوت #${r.soundId})${r.img ? '' : ' — بدون صورة'}`)) show('subs');
              }),
            ),
          );
        }),
      );
    },

    /* ---------------- 🎵 الأصوات */
    async sounds(v) {
      const { sounds, counts } = await call('sounds');
      const q = el('input', { class: 'ainput', type: 'search', placeholder: 'دوّر على صوت…', value: S.soundQ });
      const list = el('div', { class: 'alist' });
      const KIND = { custom: '🎙️ مضاف', library: '🎌 مكتبة', builtin: '🎵 نظام' };
      let audio = null;
      const draw = () => {
        list.innerHTML = '';
        const k = S.soundQ.toLowerCase();
        const rows = sounds.filter((x) => (S.soundFilter === 'all' || (S.soundFilter === 'off' ? !x.active : x.kind === S.soundFilter)) && (!k || String(x.title).toLowerCase().includes(k)));
        if (!rows.length) list.appendChild(empty('ماكو أصوات'));
        for (const x of rows.slice(0, 300)) {
          const tg = el('button', { class: 'atoggle' + (x.active ? ' on' : ''), 'aria-label': 'تفعيل' }, el('i'));
          tg.onclick = () =>
            run(tg, () => call('sound.toggle', { key: x.key })).then((r) => {
              if (!r) return;
              x.active = r.active;
              tg.classList.toggle('on', !!r.active);
              toast(r.active ? `✅ رجع: ${r.title}` : `🚫 انعطل: ${r.title}`);
            });
          list.appendChild(
            el(
              'div',
              { class: 'arow' + (x.active ? '' : ' off') },
              el(
                'button',
                {
                  class: 'aplay',
                  onclick: () => {
                    if (audio) audio.pause();
                    if (!x.url) return toast('ماكو ملف');
                    audio = new Audio(x.url);
                    audio.play().catch(() => toast('ما اشتغل الصوت'));
                  },
                },
                '▶️',
              ),
              el('div', { class: 'agrow' }, el('b', {}, `${x.emoji || ''} ${x.title}`), el('small', {}, KIND[x.kind] || x.kind)),
              x.kind === 'custom'
                ? B('✏️', 'ghost xs', async (b) => {
                    const t = await askText('الاسم الجديد', { value: x.title });
                    if (!t) return;
                    if (await run(b, () => call('sound.rename', { key: x.key, title: t }), '✏️ تغيّر الاسم')) {
                      x.title = t;
                      draw();
                    }
                  })
                : null,
              B('🗑️', 'ghost xs', async (b) => {
                if (!(await askConfirm(x.kind === 'custom' ? `تحذف «${x.title}» نهائيًا؟` : `تعطّل «${x.title}»؟ (أصوات النظام والمكتبة تنعطل بس)`, x.kind === 'custom' ? 'احذفه' : 'عطّله', true))) return;
                const r = await run(b, () => call('sound.del', { key: x.key }), (r) => (r.deleted ? '🗑️ انحذف' : '🚫 انعطل'));
                if (r) show('sounds');
              }),
              tg,
            ),
          );
        }
      };
      q.addEventListener('input', () => {
        S.soundQ = q.value.trim();
        draw();
      });
      const chips = el(
        'div',
        { class: 'achips' },
        [
          ['all', 'الكل'],
          ['custom', '🎙️ المضافة'],
          ['library', '🎌 المكتبة'],
          ['builtin', '🎵 النظام'],
          ['off', '🚫 المعطّلة'],
        ].map(([k, label]) =>
          el(
            'button',
            {
              class: 'achip' + (S.soundFilter === k ? ' on' : ''),
              onclick: (e) => {
                S.soundFilter = k;
                chips.querySelectorAll('.achip').forEach((x) => x.classList.remove('on'));
                e.currentTarget.classList.add('on');
                draw();
              },
            },
            label,
          ),
        ),
      );
      const lib = counts.library;
      const builtinOn = sounds.some((x) => (x.kind === 'builtin' || x.kind === 'library') && x.active);
      v.mount(
        el(
          'div',
          { class: 'agrid' },
          stat('✅', 'الفعّالة', fmt(counts.active)),
          stat('🎌', 'المكتبة', `${fmt(lib.on)}/${fmt(lib.ready)}`, lib.pending ? `⏳ ${lib.pending} تنزل` : lib.failed ? `❌ ${lib.failed} ما نزلت` : ''),
          stat('🎵', 'النظام', `${fmt(counts.builtin.on)}/${fmt(counts.builtin.total)}`),
          stat('🎙️', 'المضافة', `${fmt(counts.custom.on)}/${fmt(counts.custom.total)}`),
        ),
        card(
          el(
            'div',
            { class: 'adm-row wrap' },
            B(builtinOn ? '🔇 عطّل كل أصوات النظام والمكتبة' : '🔊 رجّع كل أصوات النظام والمكتبة', 'ghost sm', async (b) => {
              if (builtinOn && !(await askConfirm('تعطّل كل أصوات النظام والمكتبة؟ تبقى المضافة بس.', 'عطّلها', true))) return;
              if (await run(b, () => call('sounds.builtin', { on: !builtinOn }), '✅ تم')) show('sounds');
            }),
            lib.failed ? B(`🔄 أعد تحميل اللي ما نزلت (${lib.failed})`, 'ghost sm', async (b) => (await run(b, () => call('sounds.retry'), '🔄 جاري التحميل… يوصلك إشعار من يخلص')) && show('sounds')) : null,
          ),
          el('small', { class: 'dim' }, '➕ تضيف صوت: دزه للبوت (فويس، ملف صوت، أو فيديو) والكابشن = اسمه.'),
        ),
        card(q, chips, list),
      );
      draw();
    },

    /* ---------------- 🚫 الحظر */
    async ban(v) {
      const { list } = await call('banned');
      const id = el('input', { class: 'ainput', inputmode: 'numeric', placeholder: 'آيدي اللاعب (رقم)' });
      const reason = el('input', { class: 'ainput', placeholder: 'السبب (اختياري)' });
      v.mount(
        card(
          h('🚫 احظر لاعب'),
          id,
          reason,
          el(
            'div',
            { class: 'adm-row end' },
            B('🚫 احظره', 'red', async (b) => {
              if (!/^\d{3,15}$/.test(id.value.trim())) return toast('اكتب الآيدي رقم');
              if (await run(b, () => call('ban', { uid: id.value.trim(), reason: reason.value.trim() }), (r) => `🚫 انحظر ${r.name || 'اللاعب'}`)) show('ban');
            }),
          ),
          el('small', { class: 'dim' }, 'المحظور ما يكدر يلعب ولا يستخدم البوت، وما توصله الإذاعة. تكدر تحظر من كارت اللاعب بتبويب «اللاعبين» هم.'),
        ),
        card(
          h(`المحظورين (${list.length})`),
          list.length
            ? el(
                'div',
                { class: 'alist' },
                list.map((x) =>
                  el(
                    'div',
                    { class: 'arow' },
                    el('div', { class: 'agrow' }, el('b', {}, x.name || 'لاعب'), el('small', {}, `${idOf(x.uid)} · ${when(x.at)}${x.reason ? ' · ' + x.reason : ''}`)),
                    B('✅ فك الحظر', 'green sm', async (b) => (await run(b, () => call('unban', { uid: x.uid }), '✅ انفك الحظر')) && show('ban')),
                  ),
                ),
              )
            : empty('ماكو أحد محظور'),
        ),
      );
    },

    /* ---------------- 💰 المدفوعات */
    async pay(v) {
      const { payments } = await call('payments');
      const total = payments.filter((p) => !p.refunded).reduce((s, p) => s + (p.stars || 0), 0);
      v.mount(
        card(
          h('💰 آخر المدفوعات بالنجوم', el('span', { class: 'abadge' }, `${fmt(total)} ⭐`)),
          payments.length
            ? el(
                'div',
                { class: 'alist' },
                payments.map((p) =>
                  el(
                    'div',
                    { class: 'arow' + (p.refunded ? ' off' : '') },
                    el(
                      'div',
                      { class: 'agrow' },
                      el('b', {}, `${p.stars} ⭐ — ${packName(p.sku, p.qty)}`),
                      el('small', {}, `${p.name || 'لاعب'}${p.username ? ' @' + p.username : ''} · ${idOf(p.uid)} · ${when(p.at)}${p.refunded ? ' · ↩️ مرجّعة' : ''}`),
                    ),
                    B('📋', 'ghost xs', () => copy(p.charge)),
                    p.refunded
                      ? null
                      : B('↩️ استرجاع', 'red ghost sm', async (b) => {
                          if (!(await askConfirm(`ترجّع ${p.stars} ⭐ للاعب ${p.name || idOf(p.uid)} وتسحب منه «${packName(p.sku, p.qty)}»؟`, '↩️ رجّعها', true))) return;
                          if (await run(b, () => call('refund', { charge: p.charge }), '↩️ رجعت النجوم')) show('pay');
                        }),
                  ),
                ),
              )
            : empty('بعد ماكو مدفوعات'),
        ),
      );
    },

    /* ---------------- ⚙️ الإعدادات */
    async set(v) {
      const { stats: s } = await call('dash');
      v.mount(
        card(
          h('⚙️ الإعدادات'),
          toggleRow('🛠️ وضع الصيانة', s.maint ? 'شغّال — اللاعبين ما يكدرون يلعبون (إنت تكدر)' : 'مطفي', s.maint, async (on, b) => {
            if (on && !(await askConfirm('تشغّل الصيانة؟ اللعبة والبوت يوقفون للاعبين لحد ما تطفيها.', 'شغّلها', true))) return false;
            return run(b, () => call('maint', { on }), on ? '🛠️ الصيانة شغّالة' : '✅ طفت الصيانة');
          }),
          toggleRow('🔔 إشعار كل لاعب جديد', s.notify ? 'شغّال' : 'مطفي', s.notify, (on, b) => run(b, () => call('notify', { on }), on ? '🔔 شغّال' : '🔕 مطفي')),
        ),
        card(
          h('♻️ ريست التوب'),
          el('div', { class: 'dim' }, 'يصفّر المتصدرين (النقاط والفوز والألعاب بالترتيب) والكل يبدي من صفر. اللفلات والمايكات والأغراض والباس والمشتريات ونقاط المسابقة ما تنمس.'),
          el(
            'div',
            { class: 'adm-row end' },
            B('♻️ سوّي ريست', 'red', async (b) => {
              if (!(await askConfirm('⚠️ متأكد؟ راح ينحذف كل المتصدرين وما تكدر ترجعه.', 'إي، سوّي ريست', true))) return;
              await run(b, () => call('resetTop'), (r) => `♻️ صار ريست — ${fmt(r.n)} لاعب رجعوا صفر`);
            }),
          ),
        ),
        card(
          h('🔗 البوت'),
          el('div', { class: 'dim' }, 'إعادة الربط: إذا غيّرت التوكن أو أوامر البوت ما تبين.'),
          el('div', { class: 'adm-row end' }, B('🔗 إعادة ربط البوت', 'ghost', (b) => run(b, () => call('relink'), (r) => `✅ انربط @${r.bot}`))),
        ),
      );
    },
  };

  /* ---------------- مفتاح تشغيل/إطفاء */
  function toggleRow(title, sub, on, fn) {
    const t = el('button', { class: 'atoggle' + (on ? ' on' : '') }, el('i'));
    t.onclick = async () => {
      const r = await fn(!on, t);
      if (r === false || r === null) return;
      show(S.tab);
    };
    return el('div', { class: 'arow' }, el('div', { class: 'agrow' }, el('b', {}, title), el('small', {}, sub)), t);
  }

  /* ---------------- كارت لاعب + الهدايا */
  function giftLabel(x) {
    switch (x.gift) {
      case 'mics':
        return `${CUR.icon} ${fmt(x.mics)} مايك`;
      case 'level':
        return `⭐ لفل ${x.from} ← ${x.to}`;
      case 'items':
        return (x.items || []).map((id) => (ITEM.get(id) || {}).icon || '🎁').join(' ') + ` (${(x.items || []).length})`;
      case 'pass':
        return `🎖️ باس مميز — موسم ${x.season}`;
      case 'passlv':
        return `🎖️ +${x.levels} لفل باس`;
      default:
        return '🎁';
    }
  }

  function openUser(uid) {
    S.user = String(uid);
    S.sel = new Set();
    show('users', { top: true });
  }

  async function userView(uid, v) {
    const { user: u } = await call('user', { uid });
    const pass = u.pass;
    const owned = new Set(u.owned || []);
    const gift = async (b, kind, args, msg) => {
      const r = await run(b, () => call('gift', { uid: u.uid, kind, notify: S.notify, ...args }), (x) => msg(x) + (S.notify ? (x.dm ? ' · 📩 وصله إشعار' : ' · (ما وصله إشعار — حاظر البوت أو ما بدا وياه)') : ''));
      if (r) show('users');
    };
    // ---- مايكات
    const micsIn = el('input', { class: 'ainput num', type: 'number', min: '1', inputmode: 'numeric', value: '500' });
    // ---- لفل
    const lvIn = el('input', { class: 'ainput num', type: 'number', min: String(Math.min(MAX_LEVEL, u.level + 1)), max: String(MAX_LEVEL), inputmode: 'numeric', value: String(Math.min(MAX_LEVEL, u.level + 5)) });
    // ---- لفلات باس
    const plIn = el('input', { class: 'ainput num', type: 'number', min: '1', max: '100', inputmode: 'numeric', value: '10' });
    // ---- الأغراض
    const TYPES = [
      ['skin', '🎭 الشخصيات (السكنات)'],
      ['head', '🎩 إكسسوارات الراس'],
      ['face', '🕶️ إكسسوارات الوجه'],
      ['stage', '🏟️ المسارح'],
    ];
    const selCount = el('b', {}, '0');
    const giftItemsBtn = B('🎁 اهدي المختار', 'gold', (b) => {
      if (!S.sel.size) return toast('اختار سكن أو غرض أول');
      gift(b, 'items', { items: [...S.sel] }, (x) => `🎁 وصلته ${x.res.items.length} أغراض${x.res.had && x.res.had.length ? ` (${x.res.had.length} عنده من قبل)` : ''}`);
    });
    const updateSel = () => {
      selCount.textContent = String(S.sel.size);
      giftItemsBtn.disabled = !S.sel.size;
    };
    const itemGrid = TYPES.map(([type, label]) => {
      const items = ITEMS.filter((x) => x.type === type && x.price !== 0);
      return el(
        'div',
        { class: 'aitems-sec' },
        el('div', { class: 'aitems-h' }, label),
        el(
          'div',
          { class: 'aitems' },
          items.map((it) => {
            const has = owned.has(it.id);
            const rar = RARITY[it.rarity] || RARITY.common;
            const tile = el(
              'button',
              { class: 'aitem' + (has ? ' has' : '') + (S.sel.has(it.id) ? ' sel' : ''), style: { '--rar': rar.color }, disabled: has ? '' : null, title: it.name },
              el('div', { class: 'aitem-prev' }, meta ? safePreview(it) : el('span', { class: 'aitem-ic' }, it.icon)),
              el('small', {}, it.name),
              has ? el('em', {}, '✓ عنده') : it.pass ? el('em', { class: 'pass' }, it.pass === 'premium' ? '⭐ باس مميز' : 'باس') : el('em', {}, it.price != null ? `${CUR.icon}${fmt(it.price)}` : ''),
            );
            tile.onclick = () => {
              if (has) return;
              if (S.sel.has(it.id)) S.sel.delete(it.id);
              else S.sel.add(it.id);
              tile.classList.toggle('sel', S.sel.has(it.id));
              updateSel();
            };
            return tile;
          }),
        ),
      );
    });
    function safePreview(it) {
      try {
        return meta.preview(it);
      } catch {
        return el('span', { class: 'aitem-ic' }, it.icon);
      }
    }
    updateSel();
    const notifyBox = el('input', { type: 'checkbox', checked: S.notify });
    notifyBox.onchange = () => (S.notify = notifyBox.checked);
    const season = seasonOf();
    v.mount(
      el('div', { class: 'adm-row' }, B('→ رجوع للاعبين', 'ghost sm', () => ((S.user = null), show('users', { top: true })))),
      card(
        el(
          'div',
          { class: 'auser' },
          avatar(u, 'big'),
          el(
            'div',
            { class: 'agrow' },
            el('b', { class: 'auser-n' }, u.name || 'لاعب', u.admin ? ' 🛠️' : '', u.banned ? ' 🚫' : ''),
            el('small', {}, u.username ? '@' + u.username : 'ماعنده يوزر'),
            el('button', { class: 'aidchip', onclick: () => copy(u.id) }, `🆔 ${u.id} 📋`),
          ),
        ),
        el(
          'div',
          { class: 'agrid mini' },
          stat('⭐', 'اللفل', String(u.level), `${fmt(u.points)} نقطة`),
          stat(CUR.icon, 'المايكات', fmt(u.mics)),
          stat('🎖️', 'الباس', pass ? `${pass.level}/${pass.cap}` : '—', pass && pass.premium ? '⭐ مميز' : 'مجاني'),
          stat('🏆', 'المتصدرين', u.lb && u.lb.rank ? `#${u.lb.rank}` : '—', `${fmt(u.lb && u.lb.points)} نقطة`),
          stat('🔥', 'المسابقة', u.contest && u.contest.rank ? `#${u.contest.rank}` : '—', u.contest ? `${fmt(u.contest.points)} نقطة` : ''),
          stat('🎮', 'الألعاب', fmt(u.games), `${fmt(u.wins)} فوز`),
        ),
        el(
          'div',
          { class: 'akv' },
          el('span', {}, '📅 دخل'),
          el('b', {}, when(u.joined)),
          el('span', {}, '🕒 آخر مرة'),
          el('b', {}, ago(u.seen)),
          el('span', {}, '🌐 اللغة'),
          el('b', {}, { ar: 'العربية', en: 'English', ru: 'Русский' }[u.lang] || u.lang),
          el('span', {}, '⭐ دفع'),
          el('b', {}, `${fmt(u.stars)} نجمة`),
          el('span', {}, '📲 منين'),
          el('b', {}, u.src || '—'),
          el('span', {}, '📩 البوت'),
          el('b', {}, u.blocked ? '🚫 حاظره أو ما بدا وياه' : '✅ توصله الرسائل'),
        ),
        u.banned ? el('div', { class: 'awarn' }, `🚫 محظور ${when(u.banned.at)}${u.banned.reason ? ' — ' + u.banned.reason : ''}`) : null,
        el(
          'div',
          { class: 'adm-row wrap' },
          B('📩 رابطه بالبوت', 'ghost sm', (b) => run(b, () => call('dm', { uid: u.uid, note: 'رابط اللاعب (اضغط على الاسم):' }), '📩 دزيتلك رابطه بالبوت')),
          u.username ? B('💬 افتح حسابه', 'ghost sm', () => openTgLink('https://t.me/' + u.username)) : null,
          u.admin
            ? null
            : u.banned
              ? B('✅ فك الحظر', 'green sm', async (b) => (await run(b, () => call('unban', { uid: u.uid }), '✅ انفك الحظر')) && show('users'))
              : B('🚫 احظره', 'red ghost sm', async (b) => {
                  const reason = await askText(`سبب حظر ${u.name || u.id} (اختياري)`, { placeholder: 'السبب…', allowEmpty: true, yes: '🚫 احظره' });
                  if (reason === null) return;
                  if (await run(b, () => call('ban', { uid: u.uid, reason }), '🚫 انحظر')) show('users');
                }),
        ),
      ),
      card(h('🎁 هدية'), el('label', { class: 'acheck' }, notifyBox, el('span', {}, '📩 بلّغه بالبوت (رسالة بلغته) + نافذة هدية باللعبة'))),
      card(
        h(`${CUR.icon} مايكات`),
        el('div', { class: 'achips' }, [100, 500, 1000, 5000, 10000].map((n) => el('button', { class: 'achip', onclick: () => (micsIn.value = String(n)) }, fmt(n)))),
        el(
          'div',
          { class: 'adm-row' },
          micsIn,
          B('🎁 اهدي', 'gold', (b) => {
            const n = Math.round(Number(micsIn.value) || 0);
            if (n < 1) return toast('اكتب العدد');
            gift(b, 'mics', { n }, () => `🎁 وصلته ${fmt(n)} مايك`);
          }),
        ),
      ),
      card(
        h('⭐ لفل', el('span', { class: 'abadge' }, `هسه: ${u.level}`)),
        el(
          'div',
          { class: 'achips' },
          [5, 10, 20, 30, 50, 75, 100]
            .filter((n) => n > u.level)
            .map((n) => el('button', { class: 'achip', onclick: () => (lvIn.value = String(n)) }, `لفل ${n}`)),
        ),
        u.level >= MAX_LEVEL
          ? el('div', { class: 'dim' }, '🏆 واصل آخر لفل')
          : el(
              'div',
              { class: 'adm-row' },
              lvIn,
              B('🎁 اهدي اللفل', 'gold', (b) => {
                const to = Math.round(Number(lvIn.value) || 0);
                if (to <= u.level) return toast(`اختار لفل أعلى من ${u.level}`);
                gift(b, 'level', { to }, (x) => `⭐ صار لفل ${x.res.to}${x.res.mics ? ` (+${fmt(x.res.mics)} 🎤 جوائز اللفلات)` : ''}`);
              }),
            ),
      ),
      card(
        h('🎖️ رويال باس', el('span', { class: 'abadge' }, `الموسم ${pass ? pass.season : season}`)),
        el(
          'div',
          { class: 'adm-row wrap' },
          pass && pass.premium
            ? el('span', { class: 'abadge gold' }, '⭐ عنده المميز')
            : B('⭐ اهدي الباس المميز', 'gold', (b) => gift(b, 'pass', {}, (x) => `🎖️ تفعّل الباس المميز${x.res.rewards && x.res.rewards.length ? ` (+${x.res.rewards.length} جوائز)` : ''}`)),
        ),
        el(
          'div',
          { class: 'adm-row' },
          plIn,
          B('🎁 اهدي لفلات باس', 'pink', (b) => {
            const n = Math.round(Number(plIn.value) || 0);
            if (n < 1) return toast('اكتب العدد');
            gift(b, 'passlv', { n }, (x) => `🎖️ الباس +${x.res.levels} لفل — صار ${x.res.to}`);
          }),
        ),
        el('small', { class: 'dim' }, `المجاني يوكف على ${PASS.freeMax} — للفلات فوك ${PASS.freeMax} اهديه المميز أول.`),
      ),
      card(
        h('🎭 سكنات وأغراض', el('span', { class: 'abadge' }, el('span', {}, 'المختار: '), selCount)),
        el(
          'div',
          { class: 'adm-row wrap' },
          B('☑️ اختار كل اللي ما عنده', 'ghost sm', () => {
            for (const it of ITEMS) if (it.price !== 0 && !owned.has(it.id)) S.sel.add(it.id);
            root.querySelectorAll('.aitem:not(.has)').forEach((x) => x.classList.add('sel'));
            updateSel();
          }),
          B('✖️ شيل الاختيار', 'ghost sm', () => {
            S.sel.clear();
            root.querySelectorAll('.aitem.sel').forEach((x) => x.classList.remove('sel'));
            updateSel();
          }),
        ),
        itemGrid,
        el('div', { class: 'adm-row end sticky' }, giftItemsBtn),
      ),
    );
  }

  /* ---------------- الفائزين ودفع الجوائز */
  function winnersCard(c, d) {
    const ws = c.winners || [];
    return card(
      h(`🏁 فائزين المسابقة #${c.id}`, c.announced ? el('span', { class: 'abadge' }, '📢 انعلنوا') : null),
      ws.length
        ? el(
            'div',
            { class: 'alist' },
            ws.map((w) =>
              el(
                'div',
                { class: 'arow win' + (w.paid ? ' paid' : '') },
                el('span', { class: 'arank' }, MEDALS[w.rank - 1] || String(w.rank)),
                avatar(w),
                el(
                  'button',
                  { class: 'agrow alink', onclick: () => openUser(w.uid) },
                  el('b', {}, w.name || 'لاعب'),
                  el('small', {}, `${w.username ? '@' + w.username + ' · ' : ''}${idOf(w.uid)} · ${fmt(w.points)} نقطة${w.dm === false ? ' · ⚠️ ما وصله إشعار' : ''}`),
                ),
                el('span', { class: 'aprize big' }, `${fmt(w.prize)}⭐`),
                el(
                  'div',
                  { class: 'acol' },
                  B(w.paid ? '✅ انطيته' : '⏳ ما انطيته', w.paid ? 'green xs' : 'ghost xs', async (b) => {
                    if (await run(b, () => call('contest.paid', { cid: c.id, uid: w.uid, paid: !w.paid }), w.paid ? '⏳ رجعت «ما انطيته»' : '✅ تأشّرت: انطيته')) show('contest');
                  }),
                  B('📩 رابطه', 'ghost xs', (b) => run(b, () => call('dm', { uid: w.uid, note: `🏆 فائز ${MEDALS[w.rank - 1] || ''} — جائزته ${w.prize} ⭐ (اضغط على الاسم ← هدية ← نجوم):` }), '📩 دزيتلك رابطه بالبوت')),
                ),
              ),
            ),
          )
        : empty('ماكو فائزين (ماحد لعب ويا لاعبين ثانيين خلال المسابقة)'),
      ws.length ? el('small', { class: 'dim' }, '💸 الجوائز تنطي بإيدك: «📩 رابطه» يدزلك رابط الفائز بالبوت ← تفتح حسابه ← 🎁 هدية ← نجوم. وبعدها أشّر «✅ انطيته».') : null,
      d.winnersPreview && c.id === (d.contest && d.contest.id) ? el('details', { class: 'adetails' }, el('summary', {}, '👁️ رسالة إعلان الفائزين'), el('pre', { class: 'apreview' }, d.winnersPreview)) : null,
      el(
        'div',
        { class: 'adm-row end' },
        B(c.announced ? '📢 أعلنهم مرة ثانية' : '📢 أعلن الفائزين لكل اللاعبين', 'pink', async (b) => {
          if (!(await askConfirm(el('div', {}, el('div', {}, `توصل لـ${fmt(d.reach)} لاعب (كل واحد بلغته):`), el('pre', { class: 'apreview' }, d.winnersPreview || '')), '📢 أعلن'))) return;
          if (await run(b, () => call('contest.announce'), (x) => `📢 بدت إذاعة الفائزين لـ${fmt(x.total)} لاعب`)) show('contest');
        }),
      ),
    );
  }

  /* ---------------- فتح وسكر */
  function close(silent = false) {
    if (S.closed) return;
    S.closed = true;
    clearInterval(ticker);
    clearInterval(poll);
    offViewport();
    root.classList.add('out');
    setTimeout(() => root.remove(), 220);
    backButton(null);
    current = null;
    document.documentElement.classList.remove('adm-open');
    if (!silent && onClose) onClose();
  }

  syncSafe(root);
  const offViewport = onViewportChange(() => syncSafe(root));
  loadCss().then(() => {
    if (!S.closed) document.body.appendChild(root);
  });
  document.documentElement.classList.add('adm-open');
  backButton(() => {
    const m = root.querySelector('.adm-modal');
    if (m) return m.cancel ? m.cancel() : m.remove();
    if (S.tab === 'users' && S.user) {
      S.user = null;
      return show('users', { top: true });
    }
    close();
  });
  // العدّادات تمشي كل ثانية
  ticker = setInterval(() => {
    const now = Date.now();
    root.querySelectorAll('[data-end]').forEach((x) => {
      x.textContent = fmtLeft(Number(x.dataset.end) - now);
    });
  }, 1000);
  current = { close };
  haptic('medium');
  show(S.tab);
  return current;
}
