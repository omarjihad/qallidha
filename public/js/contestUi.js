// مسابقة المتصدرين للاعب 🔥: كارت بالقائمة (الوقت المتبقي والجوائز)، لوحة المتصدرين (المسابقة + الترتيب العام)،
// ونوافذ «وصلتك هدية» و«فزت بالمسابقة» (صندوق اللاعب بالسيرفر — كل وحدة تطلع مرة وحدة).

import { $, el, overlay } from './ui.js';
import { api, authBody } from './net.js';
import { t, LANG } from './i18n.js';
import { haptic } from './tg.js';
import { fmtLeft, hmsLeft, leftParts, daysLabel, MEDALS } from './contest.js';
import { ITEM, CUR, RARITY } from './catalog.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/** وقت النهاية بساعة الجهاز (إذا ساعة الجهاز مقدّمة أو مأخّرة) */
export function localEnd(end, serverNow) {
  return serverNow ? Number(end) + (Date.now() - Number(serverNow)) : Number(end);
}

/* ============================================================ العدّادات */
// أي عنصر بيه data-cend (وقت النهاية بساعة الجهاز) يتحدّث كل ثانية
let ticker = null;

function paint(node, now = Date.now()) {
  if (node.classList.contains('done')) return;
  const ms = Number(node.dataset.cend) - now;
  if (ms <= 0) {
    node.classList.add('done');
    node.textContent = t('🏁 خلصت المسابقة');
    return;
  }
  if (node.dataset.split) {
    const { d } = leftParts(ms);
    node.children[0].textContent = d ? daysLabel(d, LANG) : '';
    node.children[1].textContent = hmsLeft(ms);
  } else node.textContent = fmtLeft(ms, LANG);
}

function tickAll() {
  const nodes = document.querySelectorAll('[data-cend]');
  if (!nodes.length) {
    clearInterval(ticker);
    ticker = null;
    return;
  }
  const now = Date.now();
  nodes.forEach((n) => paint(n, now));
}

/** عدّاد: split = الأيام فوق والساعات تحت (للكارت الصغير) */
function clock(end, cls = '', split = false) {
  const node = split
    ? el('span', { class: 'cclock ' + cls, 'data-cend': String(end), 'data-split': '1' }, el('small'), el('b'))
    : el('span', { class: 'cclock ' + cls, 'data-cend': String(end) });
  paint(node);
  if (!ticker) ticker = setInterval(tickAll, 1000);
  return node;
}

/* ============================================================ كارت القائمة */

/** كارت المسابقة بالقائمة (بس إذا أكو مسابقة شغّالة). brief من /api/config */
export function menuCard(brief, onOpen) {
  if (!brief || !brief.end) return null;
  const end = brief.localEnd || localEnd(brief.end, brief.now);
  if (end <= Date.now()) return null;
  const p = brief.prizes || [];
  return el(
    'button',
    {
      class: 'menu-contest',
      onclick: () => {
        haptic('light');
        onOpen();
      },
    },
    el('span', { class: 'mc-fire' }, '🔥'),
    el('b', { class: 'mc-t' }, t('مسابقة المتصدرين')),
    clock(end, 'mc-left', true),
    el(
      'div',
      { class: 'mc-prizes' },
      p.map((n, i) => (n ? el('span', {}, el('i', {}, MEDALS[i]), fmt(n)) : null)),
    ),
    el('small', { class: 'mc-cta' }, t('⭐ نجوم تيليجرام')),
  );
}

/* ============================================================ لوحة المتصدرين */

function avatar(r) {
  return r.photo ? el('img', { class: 'lb-ph', src: r.photo, alt: '' }) : el('span', { class: 'lb-ph ph-empty' }, String(r.name || '?').trim().slice(0, 1) || '?');
}

function row(r, rank, meUid, extra = null) {
  return el(
    'div',
    { class: 'lb-row' + (r.id === meUid ? ' me' : '') },
    el('span', { class: 'lb-rank' }, MEDALS[rank - 1] || String(rank)),
    avatar(r),
    el('span', { class: 'lb-name' }, r.name || t('لاعب')),
    el('span', { class: 'lb-pts' }, fmt(r.points)),
    extra,
  );
}

/** الترتيب العام (كل الوقت) */
function allView(top, meUid) {
  return el(
    'div',
    { class: 'lb-list' },
    top.length ? top.map((r, i) => row(r, i + 1, meUid, el('span', { class: 'lb-wins' }, `🏆 ${r.wins}`))) : [el('div', { class: 'hint center' }, t('بعد ماكو أحد — كون أول واحد! 🎤'))],
  );
}

/** تبويب المسابقة: الوقت والجوائز وترتيبي على جهة، والمتصدرين على جهة */
function contestView(d, meUid, onPlay) {
  const c = d.contest;
  const end = localEnd(c.end, d.now);
  const running = c.status === 'running' && end > Date.now();
  const p = c.prizes || [];
  const me = d.me;
  const info = [];
  if (running) info.push(el('div', { class: 'ct-clock' }, el('small', {}, t('⏳ تبقى على انتهاء المسابقة')), clock(end, 'ct-left')));
  else info.push(el('div', { class: 'ct-clock done' }, el('b', {}, t('🏁 خلصت المسابقة')), el('small', {}, t('المسابقة الجاية قريب — خليك جاهز 💪'))));
  info.push(
    el(
      'div',
      { class: 'ct-prizes' },
      [0, 1, 2].map((i) => el('div', { class: 'ct-prize p' + (i + 1) }, el('span', {}, MEDALS[i]), el('b', {}, fmt(p[i])), el('small', {}, t('⭐ نجمة')))),
    ),
  );
  if (running) {
    if (!meUid) info.push(el('div', { class: 'ct-me' }, t('افتح اللعبة من تيليجرام حتى تشارك بالمسابقة')));
    else if (me && me.rank) info.push(el('div', { class: 'ct-me' }, t('📍 ترتيبك'), ' ', el('b', {}, `#${me.rank}`), ' · ', t('{n} نقطة', { n: fmt(me.points) })));
    else info.push(el('div', { class: 'ct-me' }, t('📍 بعدك ما دخلت — أول لعبة ويا لاعبين ثانيين تدخّلك')));
    info.push(el('div', { class: 'ct-rule' }, t('🎮 النقاط تنحسب من الألعاب ويا لاعبين ثانيين (عشوائي أو ويا ربعك) — اللعب وحدك ما ينحسب')));
    if (onPlay) info.push(el('button', { class: 'btn pink ct-play', onclick: onPlay }, t('🎲 لعب عشوائي')));
  } else {
    const mine = (d.winners || []).find((w) => w.id === meUid);
    if (mine) info.push(el('div', { class: 'ct-me win' }, t('🎉 فزت بالمركز {n}!', { n: mine.rank })));
  }

  let list;
  if (running) {
    const rows = d.top.map((r, i) => row(r, i + 1, meUid, p[i] && i < 3 ? el('span', { class: 'lb-prize' }, `${fmt(p[i])}⭐`) : null));
    // ترتيبي برا العشرين؟ يبين جوّا
    if (me && me.rank && me.rank > d.top.length && meUid) {
      rows.push(el('div', { class: 'lb-gap' }, '⋯'));
      rows.push(row({ id: meUid, name: t('إنت'), points: me.points }, me.rank, meUid));
    }
    list = el('div', { class: 'lb-list' }, rows.length ? rows : [el('div', { class: 'hint center' }, t('بعد ماكو أحد — أول لعبة ويا لاعبين ثانيين تحطك بالتوب! 🎤'))]);
  } else {
    const ws = d.winners || [];
    list = el(
      'div',
      { class: 'lb-list' },
      ws.length
        ? [el('div', { class: 'ct-wtitle' }, t('🏆 الفائزين')), ...ws.map((w) => row(w, w.rank, meUid, el('span', { class: 'lb-prize' }, `${fmt(w.prize)}⭐`)))]
        : [el('div', { class: 'hint center' }, t('ماكو فائزين هالمرة — ماحد لعب ويا لاعبين ثانيين'))],
    );
  }
  return el('div', { class: 'ct-wrap' }, el('div', { class: 'ct-info' }, info), list);
}

/**
 * لوحة المتصدرين. tab: 'contest' | 'all' — إذا ماكو مسابقة (ولا خلصت وحدة) يبين الترتيب العام بس.
 * onPlay: زر «لعب عشوائي» من تبويب المسابقة.
 */
export function openBoard({ tab = 'contest', meUid = '', onClose = null, onPlay = null } = {}) {
  let cur = tab;
  let contest = null;
  let top = null;
  let topErr = null;
  let drawn = false;
  const body = el('div', { class: 'board-body' }, el('div', { class: 'hint center' }, t('جاري التحميل…')));
  const tabs = el('div', { class: 'tabs board-tabs' });
  const panel = el(
    'div',
    { class: 'panel board v2' },
    el('button', { class: 'xbtn', 'aria-label': t('سكّر'), onclick: () => onClose && onClose() }, '✕'),
    el('div', { class: 'panel-title' }, t('🏆 المتصدرين')),
    tabs,
    body,
  );
  overlay(panel, 'panel-layer');

  const draw = () => {
    if (!panel.isConnected) return;
    const hasContest = !!(contest && contest.contest);
    if (!hasContest) cur = 'all';
    tabs.innerHTML = '';
    if (hasContest) {
      const live = contest.contest.status === 'running' && localEnd(contest.contest.end, contest.now) > Date.now();
      for (const [k, label] of [
        ['contest', live ? t('🔥 المسابقة') : t('🏁 آخر مسابقة')],
        ['all', t('🏆 الترتيب العام')],
      ]) {
        tabs.appendChild(
          el(
            'button',
            {
              class: 'tab' + (k === cur ? ' on' : ''),
              onclick: () => {
                if (cur === k) return;
                haptic('select');
                cur = k;
                draw();
              },
            },
            label,
          ),
        );
      }
    }
    body.innerHTML = '';
    if (cur === 'contest') body.appendChild(contestView(contest, meUid, onPlay));
    else if (top) body.appendChild(allView(top, meUid));
    else body.appendChild(el('div', { class: 'hint center' }, topErr ? t(topErr.message || 'خطأ بالاتصال') : t('جاري التحميل…')));
    drawn = true;
  };

  // المسابقة أول (تحدد التبويبات)، والترتيب العام يوصل وياها
  const pt = api('/api/top')
    .then((d) => d.top || [])
    .catch((e) => {
      topErr = e;
      return null;
    });
  api('/api/contest', authBody())
    .catch(() => null)
    .then((d) => {
      contest = d;
      if (contest && contest.contest && cur === 'contest') draw();
      return pt;
    })
    .then((tp) => {
      top = tp;
      if (cur === 'all' || !drawn) draw();
    });
  return panel;
}

/* ============================================================ صندوق اللاعب: هدايا وفوز */

let queue = [];
let showing = false;
// اللي طلعت بهالجلسة (حتى لو السيرفر بعده ما سجّلها) — ما تتكرر
const shown = new Set();

/** يضيف للطابور (من /api/me) — تطلع من ترجع القائمة */
export function queueInbox(items) {
  for (const x of items || []) {
    if (!x || (x.kind !== 'gift' && x.kind !== 'win') || shown.has(x.id) || queue.some((q) => q.id === x.id)) continue;
    queue.push(x);
  }
}

export function hasInbox() {
  return queue.length > 0;
}

/** النافذة تسكّرت: السيرفر يعلّمها «شافها» (إذا ما وصل، ترجع تطلع المرة الجاية — أحسن من تضيع) */
function ack(id) {
  if (id) api('/api/inbox/seen', { ...authBody(), ids: [id] }).catch(() => null);
}

/** يطلّع اللي بالطابور وحدة وحدة. meta: لمعاينة الأغراض */
export function flushInbox(meta = null) {
  if (showing || !queue.length) return;
  showing = true;
  const next = () => {
    const x = queue.shift();
    if (!x) {
      showing = false;
      return;
    }
    shown.add(x.id);
    popup(x, meta, () => {
      ack(x.id);
      next();
    });
  };
  next();
}

function itemTile(id, meta) {
  const it = ITEM.get(id);
  if (!it) return null;
  let prev;
  try {
    prev = meta ? meta.preview(it) : null;
  } catch {
    prev = null;
  }
  return el(
    'div',
    { class: 'ib-item', style: { '--rar': (RARITY[it.rarity] || RARITY.common).color } },
    el('div', { class: 'it-prev' }, prev || el('div', { class: 'it-emoji' }, it.icon)),
    el('small', {}, t(it.name)),
  );
}

function confetti() {
  return el(
    'div',
    { class: 'confetti' },
    Array.from({ length: 30 }, (_, i) =>
      el('i', { style: { left: `${(i * 97) % 100}%`, animationDelay: `${(i % 10) * 0.14}s`, background: ['#ff4f8b', '#ffd60a', '#3a86ff', '#7ed321', '#ff8c1a'][i % 5] } }),
    ),
  );
}

function popup(x, meta, done) {
  const parts = [];
  let icon = '🎁';
  let btn = t('تسلم! 💖');
  let party = false;
  if (x.kind === 'win') {
    icon = '🏆';
    party = true;
    btn = t('يا سلام! 🎉');
    const place = [t('الأول'), t('الثاني'), t('الثالث')][x.rank - 1] || String(x.rank);
    parts.push(el('div', { class: 'ib-title' }, t('🎉 مبروك! فزت بمسابقة المتصدرين')));
    parts.push(el('div', { class: 'ib-sub' }, t('المركز {place} — {p} نقطة', { place, p: fmt(x.points) })));
    parts.push(el('div', { class: 'ib-prize' }, `${MEDALS[x.rank - 1] || ''} ${fmt(x.prize)} ⭐`, el('small', {}, t('نجمة تيليجرام'))));
    parts.push(el('div', { class: 'ib-note' }, t('🎁 الجائزة توصلك من المطوّر قريبًا.')));
  } else {
    parts.push(el('div', { class: 'ib-title' }, t('🎁 وصلتك هدية من المطوّر!')));
    const chips = [];
    let tiles = [];
    if (x.gift === 'mics') chips.push(el('div', { class: 'rw up' }, el('b', {}, `+${fmt(x.mics)}`), el('span', {}, `${CUR.icon} ${t('مايكات')}`)));
    else if (x.gift === 'level') {
      chips.push(el('div', { class: 'rw up' }, el('b', {}, `⭐ ${x.from} ← ${x.to}`), el('span', {}, t('لفل جديد'))));
      if (x.mics) chips.push(el('div', { class: 'rw' }, el('b', {}, `+${fmt(x.mics)}`), el('span', {}, `${CUR.icon} ${t('مايكات')}`)));
    } else if (x.gift === 'pass') chips.push(el('div', { class: 'rw up' }, el('b', {}, '🎖️'), el('span', {}, t('الرويال باس المميز'))));
    else if (x.gift === 'passlv') chips.push(el('div', { class: 'rw up' }, el('b', {}, `🎖️ +${x.levels}`), el('span', {}, t('لفل بالرويال باس — صرت {n}', { n: x.to }))));
    else if (x.gift === 'items') tiles = (x.items || []).slice(0, 8).map((id) => itemTile(id, meta));
    // جوائز الباس اللي وصلته وياها
    const rw = x.rewards || [];
    const rwMics = rw.reduce((s, r) => s + (r.mics || 0) + (r.dup || 0), 0);
    for (const r of rw.filter((r) => r.item && !r.dup)) tiles.push(itemTile(r.item, meta));
    if (rwMics) chips.push(el('div', { class: 'rw' }, el('b', {}, `+${fmt(rwMics)}`), el('span', {}, `${CUR.icon} ${t('من الباس')}`)));
    if (chips.length) parts.push(el('div', { class: 'rw-items ib-chips' }, chips));
    tiles = tiles.filter(Boolean);
    if (tiles.length) parts.push(el('div', { class: 'ib-items' }, tiles));
    const more = x.gift === 'items' ? (x.items || []).length - 8 : 0;
    if (more > 0) parts.push(el('div', { class: 'ib-note' }, t('+{n} غرض ثاني — شوفها بالمتجر', { n: more })));
  }
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    haptic('light');
    layer.classList.add('out');
    setTimeout(() => {
      layer.remove();
      done();
    }, 220);
  };
  const layer = el(
    'div',
    { class: 'ib-layer' },
    party ? confetti() : null,
    el('div', { class: 'panel ib' + (party ? ' win' : '') }, el('div', { class: 'ib-ic' }, icon), parts, el('button', { class: 'btn gold ib-ok', onclick: close }, btn)),
  );
  $('#app').appendChild(layer);
  haptic('success');
}
