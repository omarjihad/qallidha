// اقتصاد اللعبة داخل الـHub: المايكات، اللفلات، المخزون، الرويال باس، ومكافآت الإعلانات.
// كل شي هنا متزامن (SQLite داخل الـDurable Object) فما يصير سباق بين طلبين.

import {
  ITEMS,
  ITEM,
  SLOTS,
  DEFAULT_EQUIP,
  isFree,
  levelOf,
  levelProgress,
  levelReward,
  gameMics,
  seasonOf,
  seasonEnd,
  PASS,
  passLevel,
  passReward,
  ADS,
  dayKey,
  RARITY,
  STAR_PACK,
} from '../public/js/catalog.js';

const DUP_MICS = { common: 80, rare: 150, epic: 300, legendary: 500 };
const INTENT_TTL = 10 * 60 * 1000;

function rnd() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}

export class Economy {
  constructor(sql) {
    this.sql = sql;
    const cols = [
      'mics INTEGER DEFAULT 0',
      "equip TEXT DEFAULT '{}'",
      'pass_season INTEGER DEFAULT 0',
      'pass_xp INTEGER DEFAULT 0',
      'pass_prem INTEGER DEFAULT 0',
      'pass_got INTEGER DEFAULT 0',
      'pass_got_p INTEGER DEFAULT 0',
      "lang TEXT DEFAULT ''",
    ];
    for (const c of cols) {
      try {
        sql.exec('ALTER TABLE users ADD COLUMN ' + c);
      } catch {
        /* موجود */
      }
    }
    sql.exec('CREATE TABLE IF NOT EXISTS inv (uid TEXT, item TEXT, until INTEGER DEFAULT 0, PRIMARY KEY (uid, item))');
    sql.exec('CREATE TABLE IF NOT EXISTS adprog (uid TEXT, item TEXT, n INTEGER DEFAULT 0, PRIMARY KEY (uid, item))');
    sql.exec('CREATE TABLE IF NOT EXISTS daily (uid TEXT, day TEXT, kind TEXT, n INTEGER DEFAULT 0, PRIMARY KEY (uid, day, kind))');
    sql.exec('CREATE TABLE IF NOT EXISTS intents (uid TEXT PRIMARY KEY, nonce TEXT, kind TEXT, item TEXT, at INTEGER, status TEXT, result TEXT)');
    sql.exec('CREATE TABLE IF NOT EXISTS lastgame (uid TEXT PRIMARY KEY, gkey TEXT, mics INTEGER, doubled INTEGER DEFAULT 0, at INTEGER)');
    sql.exec('CREATE TABLE IF NOT EXISTS payments (charge TEXT PRIMARY KEY, uid TEXT, season INTEGER, stars INTEGER, at INTEGER, refunded INTEGER DEFAULT 0)');
    for (const c of ["sku TEXT DEFAULT 'pass'", 'qty INTEGER DEFAULT 0']) {
      try {
        sql.exec('ALTER TABLE payments ADD COLUMN ' + c);
      } catch {
        /* موجود */
      }
    }
  }

  /* ============================================================ أساسيات */

  ensureUser(uid, name = '', photo = '', lang = '') {
    // lang: لغة اللعبة عند اللاعب (حتى البوت يحچي وياه بنفسها)
    const lg = ['ar', 'ru', 'en'].includes(lang) ? lang : '';
    this.sql.exec(
      `INSERT INTO users (id, name, photo, updated, lang) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE users.name END,
         photo = CASE WHEN excluded.photo <> '' THEN excluded.photo ELSE users.photo END,
         lang = CASE WHEN excluded.lang <> '' THEN excluded.lang ELSE users.lang END`,
      uid,
      name || '',
      photo || '',
      Date.now(),
      lg,
    );
  }

  langOf(uid) {
    const r = this.sql.exec('SELECT lang FROM users WHERE id = ?', uid).toArray()[0];
    return (r && r.lang) || '';
  }

  row(uid) {
    return this.sql.exec('SELECT * FROM users WHERE id = ?', uid).toArray()[0] || null;
  }

  addMics(uid, n) {
    if (!n) return;
    this.sql.exec('UPDATE users SET mics = MAX(0, mics + ?) WHERE id = ?', Math.round(n), uid);
  }

  /** المخزون: Map(item → until) بس اللي صالح هسه (0 = للأبد) */
  owned(uid, now = Date.now()) {
    const m = new Map();
    for (const r of this.sql.exec('SELECT item, until FROM inv WHERE uid = ?', uid).toArray()) {
      if (!r.until || r.until > now) m.set(r.item, r.until || 0);
    }
    return m;
  }

  has(uid, itemId, owned = null) {
    const it = ITEM.get(itemId);
    if (!it) return false;
    if (isFree(it)) return true;
    return (owned || this.owned(uid)).has(itemId);
  }

  ownsForever(uid, itemId) {
    const it = ITEM.get(itemId);
    if (!it) return false;
    if (isFree(it)) return true;
    const r = this.sql.exec('SELECT until FROM inv WHERE uid = ? AND item = ?', uid, itemId).toArray()[0];
    return !!r && !r.until;
  }

  /** يعطي غرض للأبد. إذا عنده إياه للأبد أصلًا يرجع false */
  giveItem(uid, itemId) {
    if (this.ownsForever(uid, itemId)) return false;
    this.sql.exec('INSERT INTO inv (uid, item, until) VALUES (?, ?, 0) ON CONFLICT(uid, item) DO UPDATE SET until = 0', uid, itemId);
    this.sql.exec('DELETE FROM adprog WHERE uid = ? AND item = ?', uid, itemId);
    return true;
  }

  daily(uid, kind, now = Date.now()) {
    const r = this.sql.exec('SELECT n FROM daily WHERE uid = ? AND day = ? AND kind = ?', uid, dayKey(now), kind).toArray()[0];
    return r ? r.n : 0;
  }

  bumpDaily(uid, kind, now = Date.now()) {
    this.sql.exec(
      'INSERT INTO daily (uid, day, kind, n) VALUES (?, ?, ?, 1) ON CONFLICT(uid, day, kind) DO UPDATE SET n = n + 1',
      uid,
      dayKey(now),
      kind,
    );
  }

  equipOf(row, owned) {
    let e = {};
    try {
      e = JSON.parse(row.equip || '{}') || {};
    } catch {
      e = {};
    }
    const out = { ...DEFAULT_EQUIP };
    for (const slot of SLOTS) {
      const id = e[slot];
      const it = id && ITEM.get(id);
      if (it && it.type === slot && (isFree(it) || owned.has(id))) out[slot] = id;
    }
    return out;
  }

  /* ============================================================ الرويال باس */

  passOf(row, now = Date.now()) {
    const season = seasonOf(now);
    const same = row && row.pass_season === season;
    const xp = same ? row.pass_xp : 0;
    const premium = !!row && row.pass_prem === season;
    const got = same ? row.pass_got : 0;
    const gotP = same ? row.pass_got_p : 0;
    return { season, endsAt: seasonEnd(season), xp, premium, got, gotP, level: passLevel(xp, premium), cap: premium ? PASS.premiumMax : PASS.freeMax };
  }

  /** يجدد الباس إذا بدا موسم جديد (يصفّر الخبرة والجوائز) */
  touchSeason(uid, now = Date.now()) {
    const season = seasonOf(now);
    this.sql.exec(
      'UPDATE users SET pass_season = ?, pass_xp = 0, pass_got = 0, pass_got_p = 0 WHERE id = ? AND pass_season <> ?',
      season,
      uid,
      season,
    );
  }

  /** يمنح جوائز اللفلات اللي وصلها وما استلمها. يرجع قائمة الجوائز. */
  grantPassRewards(uid, now = Date.now()) {
    const row = this.row(uid);
    if (!row) return [];
    const p = this.passOf(row, now);
    const out = [];
    const give = (track, level) => {
      const r = passReward(level, track);
      if (!r) return;
      if (r.mics) {
        this.addMics(uid, r.mics);
        out.push({ track, level, mics: r.mics });
      } else if (r.item) {
        if (this.giveItem(uid, r.item)) out.push({ track, level, item: r.item });
        else {
          const comp = DUP_MICS[(ITEM.get(r.item) || {}).rarity] || 100;
          this.addMics(uid, comp);
          out.push({ track, level, item: r.item, dup: comp });
        }
      }
    };
    const freeTo = Math.min(p.level, PASS.freeMax);
    for (let l = p.got + 1; l <= freeTo; l++) give('free', l);
    if (p.premium) for (let l = p.gotP + 1; l <= p.level; l++) give('premium', l);
    this.sql.exec(
      'UPDATE users SET pass_got = MAX(pass_got, ?), pass_got_p = MAX(pass_got_p, ?) WHERE id = ?',
      freeTo,
      p.premium ? p.level : row.pass_got_p,
      uid,
    );
    return out;
  }

  addPassXp(uid, xp, now = Date.now()) {
    this.touchSeason(uid, now);
    const before = this.passOf(this.row(uid), now);
    this.sql.exec('UPDATE users SET pass_xp = pass_xp + ? WHERE id = ?', Math.max(0, Math.round(xp)), uid);
    const rewards = this.grantPassRewards(uid, now);
    const after = this.passOf(this.row(uid), now);
    return { xp: Math.round(xp), from: before.level, to: after.level, rewards };
  }

  canBuyPass(uid, season, now = Date.now()) {
    if (season !== seasonOf(now)) return { ok: false, error: 'الموسم خلص، افتح الباس من جديد واطلب فاتورة جديدة' };
    const row = this.row(uid);
    if (row && row.pass_prem === season) return { ok: false, error: 'عندك الباس المميز لهالموسم ✅' };
    return { ok: true };
  }

  grantPremium(uid, payloadSeason, charge, stars, now = Date.now()) {
    const dup = this.sql.exec('SELECT uid FROM payments WHERE charge = ?', charge).toArray()[0];
    if (dup) return { ok: true, already: true };
    // دفع بآخر ثواني الموسم ووصلت الدفعة بعد ما بدا الجديد: ياخذ الموسم الجديد
    const season = Math.max(payloadSeason, seasonOf(now));
    this.ensureUser(uid);
    this.sql.exec('INSERT INTO payments (charge, uid, season, stars, at) VALUES (?, ?, ?, ?, ?)', charge, uid, season, stars, now);
    this.touchSeason(uid, now);
    this.sql.exec('UPDATE users SET pass_prem = ? WHERE id = ?', season, uid);
    const rewards = this.grantPassRewards(uid, now);
    return { ok: true, season, rewards, pass: this.passOf(this.row(uid), now) };
  }

  /* ============================================================ باقات النجوم ⭐ */

  /** يكدر يشتري الباقة هسه؟ (نفس الفحص بالفاتورة وبموافقة الدفع) */
  canBuyPack(uid, sku, season, now = Date.now()) {
    const pack = STAR_PACK.get(sku);
    if (!pack) return { ok: false, error: 'هاي الباقة مو موجودة' };
    if (pack.kind === 'mics') return { ok: true };
    if (season !== seasonOf(now)) return { ok: false, error: 'الموسم خلص، افتح الباس من جديد واطلب فاتورة جديدة' };
    const row = this.row(uid);
    const p = this.passOf(row, now);
    if (pack.kind === 'passplus') {
      if (p.premium) return { ok: false, error: 'عندك الباس المميز لهالموسم ✅' };
      return { ok: true };
    }
    if (p.level >= p.cap) return { ok: false, error: p.premium ? 'خلصت الباس كله 🎉' : 'المجاني يوكف على 50 — افتح المميز حتى تكمل لحد 100' };
    if (p.level + pack.levels > p.cap) return { ok: false, error: p.premium ? 'اللفلات الباقية أقل من الباقة — اختار باقة أصغر' : 'المجاني يوكف على 50 — اختار باقة أصغر أو افتح المميز' };
    return { ok: true };
  }

  /** يسلّم الباقة بعد الدفع (مرة وحدة لكل دفعة) */
  grantPack(uid, sku, payloadSeason, charge, stars, now = Date.now()) {
    const pack = STAR_PACK.get(sku);
    if (!pack) return { ok: false, error: 'باقة غلط' };
    const dup = this.sql.exec('SELECT uid FROM payments WHERE charge = ?', charge).toArray()[0];
    if (dup) return { ok: true, already: true, kind: pack.kind };
    const season = Math.max(payloadSeason || 0, seasonOf(now));
    this.ensureUser(uid);
    const qty = pack.kind === 'mics' ? pack.mics : pack.levels;
    this.sql.exec('INSERT INTO payments (charge, uid, season, stars, at, sku, qty) VALUES (?, ?, ?, ?, ?, ?, ?)', charge, uid, season, stars, now, sku, qty);
    if (pack.kind === 'mics') {
      this.addMics(uid, pack.mics);
      return { ok: true, kind: 'mics', mics: pack.mics };
    }
    this.touchSeason(uid, now);
    if (pack.kind === 'passplus') this.sql.exec('UPDATE users SET pass_prem = ? WHERE id = ?', season, uid);
    const pass = this.addPassXp(uid, pack.levels * PASS.xpPerLevel, now);
    return { ok: true, kind: pack.kind, season, premium: pack.kind === 'passplus', pass };
  }

  paymentByCharge(charge) {
    return this.sql.exec('SELECT * FROM payments WHERE charge = ?', charge).toArray()[0] || null;
  }

  /** بعد استرجاع النجوم: نسحب اللي انطاه (الجوائز اللي استلمها تبقى) */
  markRefunded(charge, now = Date.now()) {
    const p = this.paymentByCharge(charge);
    if (!p) return null;
    if (p.refunded) return p;
    this.sql.exec('UPDATE payments SET refunded = 1 WHERE charge = ?', charge);
    const sku = p.sku || 'pass';
    const pack = STAR_PACK.get(sku);
    if (sku === 'pass' || (pack && pack.kind === 'passplus')) this.sql.exec('UPDATE users SET pass_prem = 0 WHERE id = ? AND pass_prem = ?', p.uid, p.season);
    if (pack && pack.kind === 'mics') this.addMics(p.uid, -(p.qty || pack.mics));
    if (pack && (pack.kind === 'levels' || pack.kind === 'passplus'))
      this.sql.exec('UPDATE users SET pass_xp = MAX(0, pass_xp - ?) WHERE id = ? AND pass_season = ?', (p.qty || pack.levels) * PASS.xpPerLevel, p.uid, p.season);
    return p;
  }

  /* ============================================================ نهاية اللعبة */

  /** يسجّل نتيجة لعبة ويرجع مكافآت كل لاعب تيليجرام: {uid: {...}} */
  recordGame(results, winner, gkey, now = Date.now()) {
    const out = {};
    for (const r of results) {
      if (r.guest || !r.uid) continue;
      const score = Math.max(0, Math.round(r.score || 0));
      const isWin = r.uid === winner;
      const before = this.row(r.uid);
      const ptsBefore = before ? before.points : 0;
      this.sql.exec(
        `INSERT INTO users (id, name, photo, games, wins, points, best, updated) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, photo = CASE WHEN excluded.photo <> '' THEN excluded.photo ELSE users.photo END,
           games = games + 1, wins = wins + excluded.wins, points = points + excluded.points, best = MAX(best, excluded.best), updated = excluded.updated`,
        r.uid,
        r.name || '',
        r.photo || '',
        isWin ? 1 : 0,
        score,
        score,
        now,
      );
      const lvFrom = levelOf(ptsBefore);
      const lvTo = levelOf(ptsBefore + score);
      let levelMics = 0;
      for (let l = lvFrom + 1; l <= lvTo; l++) levelMics += levelReward(l);
      // بونص الفوز بس إذا اكو منافس (اللعب وحدك ما ينطي بونص)
      const mics = gameMics(score, isWin && results.length > 1);
      this.addMics(r.uid, mics + levelMics);
      this.sql.exec(
        `INSERT INTO lastgame (uid, gkey, mics, doubled, at) VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(uid) DO UPDATE SET gkey = excluded.gkey, mics = excluded.mics, doubled = 0, at = excluded.at`,
        r.uid,
        gkey,
        mics,
        now,
      );
      const pass = this.addPassXp(r.uid, score, now);
      const row = this.row(r.uid);
      out[r.uid] = { mics, levelMics, lvFrom, lvTo, pass, total: row.mics, gkey };
    }
    return out;
  }

  /* ============================================================ المتجر */

  buy(uid, itemId) {
    const it = ITEM.get(itemId);
    if (!it) return { error: 'ماكو هيج غرض' };
    if (it.price == null) return { error: 'هذا الغرض بس من الرويال باس' };
    if (this.ownsForever(uid, itemId)) return { error: 'عندك إياه' };
    const row = this.row(uid);
    if (!row || row.mics < it.price) return { error: 'مايكاتك ما تكفي', need: it.price - (row ? row.mics : 0) };
    this.addMics(uid, -it.price);
    this.giveItem(uid, itemId);
    return { ok: true };
  }

  equip(uid, slot, itemId) {
    if (!SLOTS.includes(slot)) return { error: 'خانة غلط' };
    const row = this.row(uid);
    if (!row) return { error: 'ماكو حساب' };
    let e = {};
    try {
      e = JSON.parse(row.equip || '{}') || {};
    } catch {
      e = {};
    }
    if (itemId == null) {
      if (slot === 'stage') e.stage = 'stage:classic';
      else e[slot] = null;
    } else {
      const it = ITEM.get(itemId);
      if (!it || it.type !== slot) return { error: 'هذا مو لهالخانة' };
      if (!this.has(uid, itemId)) return { error: 'ما عندك هذا الغرض' };
      e[slot] = itemId;
    }
    this.sql.exec('UPDATE users SET equip = ? WHERE id = ?', JSON.stringify(e), uid);
    return { ok: true, equip: this.equipOf({ equip: JSON.stringify(e) }, this.owned(uid)) };
  }

  /** شكل اللاعب للغرفة (بس الأشياء الصالحة) */
  lookOf(uid) {
    const row = this.row(uid);
    if (!row) return { skin: null, head: null, face: null, stage: 'stage:classic', level: 1 };
    const eq = this.equipOf(row, this.owned(uid));
    const skin = eq.skin ? ITEM.get(eq.skin).skin : null;
    return { skin, head: eq.head, face: eq.face, stage: eq.stage, level: levelOf(row.points) };
  }

  /* ============================================================ الإعلانات المكافأة */

  /** يتحقق إذا نوع الإعلان مسموح هسه (قبل العرض وبعده) */
  adCheck(uid, kind, itemId, now = Date.now()) {
    const row = this.row(uid);
    if (!row) return 'ماكو حساب';
    switch (kind) {
      case 'coins':
        return this.daily(uid, 'coins', now) < ADS.coins.perDay ? null : 'خلصت المايكات المجانية لليوم — ارجع باچر';
      case 'box':
        return this.daily(uid, 'box', now) < ADS.box.perDay ? null : 'فتحت صندوق اليوم — ارجع باچر';
      case 'pass':
        return this.daily(uid, 'pass', now) < ADS.pass.perDay ? null : 'خلص تقدّم الباس بالإعلانات لليوم';
      case 'double': {
        const g = this.sql.exec('SELECT * FROM lastgame WHERE uid = ?', uid).toArray()[0];
        if (!g || g.doubled || now - g.at > ADS.doubleWindowMs || !g.mics) return 'ماكو لعبة تضاعفها';
        return null;
      }
      case 'unlock': {
        const it = ITEM.get(itemId);
        if (!it || !it.ads) return 'هذا الغرض ما ينفتح بإعلان';
        if (this.ownsForever(uid, itemId)) return 'عندك إياه';
        return null;
      }
      case 'trial': {
        const it = ITEM.get(itemId);
        if (!it || it.price == null || isFree(it)) return 'هذا الغرض ما تكدر تجرّبه';
        if (this.ownsForever(uid, itemId)) return 'عندك إياه';
        return null;
      }
      default:
        return 'نوع غلط';
    }
  }

  adIntent(uid, kind, itemId = null, now = Date.now()) {
    const err = this.adCheck(uid, kind, itemId, now);
    if (err) return { error: err };
    const nonce = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, '0')).join('');
    this.sql.exec(
      `INSERT INTO intents (uid, nonce, kind, item, at, status, result) VALUES (?, ?, ?, ?, ?, 'pending', NULL)
       ON CONFLICT(uid) DO UPDATE SET nonce = excluded.nonce, kind = excluded.kind, item = excluded.item, at = excluded.at, status = 'pending', result = NULL`,
      uid,
      nonce,
      kind,
      itemId,
      now,
    );
    return { ok: true, nonce };
  }

  /** يطبّق مكافأة آخر إعلان (من رابط AdsGram أو من الواجهة). nonce اختياري للتأكد. */
  adReward(uid, nonce = null, now = Date.now()) {
    const it = this.sql.exec('SELECT * FROM intents WHERE uid = ?', uid).toArray()[0];
    if (!it) return { error: 'ماكو إعلان منتظر' };
    if (nonce && it.nonce !== nonce) return { error: 'إعلان قديم' };
    if (it.status === 'done') return { ok: true, result: JSON.parse(it.result || '{}'), already: true };
    if (now - it.at > INTENT_TTL) return { error: 'تأخرت كلش، جرّب مرة ثانية' };
    const err = this.adCheck(uid, it.kind, it.item, now);
    let result;
    if (err) result = { kind: it.kind, error: err };
    else result = this.applyAd(uid, it.kind, it.item, now);
    this.sql.exec("UPDATE intents SET status = 'done', result = ? WHERE uid = ?", JSON.stringify(result), uid);
    return { ok: !result.error, result };
  }

  adStatus(uid, nonce) {
    const it = this.sql.exec('SELECT * FROM intents WHERE uid = ?', uid).toArray()[0];
    if (!it || it.nonce !== nonce) return { error: 'ماكو' };
    return it.status === 'done' ? { ok: true, result: JSON.parse(it.result || '{}') } : { pending: true };
  }

  applyAd(uid, kind, itemId, now) {
    switch (kind) {
      case 'coins':
        this.bumpDaily(uid, 'coins', now);
        this.addMics(uid, ADS.coins.mics);
        return { kind, mics: ADS.coins.mics };
      case 'pass':
        this.bumpDaily(uid, 'pass', now);
        return { kind, pass: this.addPassXp(uid, ADS.pass.xp, now) };
      case 'double': {
        const g = this.sql.exec('SELECT * FROM lastgame WHERE uid = ?', uid).toArray()[0];
        this.sql.exec('UPDATE lastgame SET doubled = 1 WHERE uid = ?', uid);
        this.addMics(uid, g.mics);
        return { kind, mics: g.mics };
      }
      case 'box': {
        this.bumpDaily(uid, 'box', now);
        const r = rnd();
        if (r < 0.2) {
          const owned = this.owned(uid);
          const pool = ITEMS.filter((x) => (x.type === 'head' || x.type === 'face') && x.price != null && !isFree(x) && !owned.has(x.id) && x.rarity !== 'epic');
          if (pool.length) {
            const pick = pool[Math.floor(rnd() * pool.length)];
            this.giveItem(uid, pick.id);
            return { kind, item: pick.id };
          }
        }
        if (r < 0.5) return { kind, pass: this.addPassXp(uid, 150, now) };
        const mics = 40 + Math.floor(rnd() * 9) * 10;
        this.addMics(uid, mics);
        return { kind, mics };
      }
      case 'unlock': {
        const item = ITEM.get(itemId);
        this.sql.exec('INSERT INTO adprog (uid, item, n) VALUES (?, ?, 1) ON CONFLICT(uid, item) DO UPDATE SET n = n + 1', uid, itemId);
        const n = this.sql.exec('SELECT n FROM adprog WHERE uid = ? AND item = ?', uid, itemId).one().n;
        if (n >= item.ads) {
          this.giveItem(uid, itemId);
          return { kind, item: itemId, unlocked: true, n: item.ads, need: item.ads };
        }
        return { kind, item: itemId, unlocked: false, n, need: item.ads };
      }
      case 'trial': {
        const until = now + ADS.trialHours * 3600000;
        this.sql.exec(
          'INSERT INTO inv (uid, item, until) VALUES (?, ?, ?) ON CONFLICT(uid, item) DO UPDATE SET until = CASE WHEN inv.until = 0 THEN 0 ELSE excluded.until END',
          uid,
          itemId,
          until,
        );
        return { kind, item: itemId, until };
      }
      default:
        return { kind, error: 'نوع غلط' };
    }
  }

  /* ============================================================ الملف الشخصي */

  profile(uid, now = Date.now()) {
    const row = this.row(uid);
    if (!row) return null;
    const owned = this.owned(uid, now);
    const prog = Object.fromEntries(this.sql.exec('SELECT item, n FROM adprog WHERE uid = ?', uid).toArray().map((r) => [r.item, r.n]));
    const g = this.sql.exec('SELECT * FROM lastgame WHERE uid = ?', uid).toArray()[0];
    const pass = this.passOf(row, now);
    return {
      level: levelProgress(row.points),
      points: row.points,
      mics: row.mics,
      owned: Object.fromEntries(owned),
      adProgress: prog,
      equip: this.equipOf(row, owned),
      pass: { season: pass.season, endsAt: pass.endsAt, xp: pass.xp, level: pass.level, premium: pass.premium, cap: pass.cap },
      daily: {
        coins: ADS.coins.perDay - this.daily(uid, 'coins', now),
        box: ADS.box.perDay - this.daily(uid, 'box', now),
        pass: ADS.pass.perDay - this.daily(uid, 'pass', now),
      },
      lastGame: g ? { gkey: g.gkey, mics: g.mics, canDouble: !g.doubled && now - g.at <= ADS.doubleWindowMs && g.mics > 0 } : null,
    };
  }
}

export { RARITY };
