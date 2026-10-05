// الكائن المركزي: اللاعبين والترتيب، الأصوات (المكتبة والمضافة والمقترحة)، الغرف العامة، لوحة المطوّر، وإعدادات الـwebhook.

import { DurableObject } from 'cloudflare:workers';
import { BUILTIN_SOUNDS } from './builtin-sounds.js';
import { LIBRARY_SOUNDS, LIBRARY_BY_SLUG } from './library-sounds.js';
import { fetchLibrarySound } from './myinstants.js';
import { Tg, adminIds } from './telegram.js';
import { webhookSecret, toHex } from './auth.js';
import { Economy } from './economy.js';
import { MAX_PLAYERS } from '../public/js/shared.js';

const LIB_MAX_TRIES = 3;

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT, photo TEXT,
        games INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, points INTEGER DEFAULT 0, best INTEGER DEFAULT 0,
        updated INTEGER)`,
    );
    this.sql.exec('CREATE INDEX IF NOT EXISTS users_points ON users(points DESC)');
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS sounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, file_id TEXT, kind TEXT,
        img_file_id TEXT, dur REAL DEFAULT 0, added_by TEXT, created INTEGER,
        plays INTEGER DEFAULT 0, active INTEGER DEFAULT 1)`,
    );
    this.sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
    // أصوات معطّلة من النظام والمكتبة (b:… و m:…)
    this.sql.exec('CREATE TABLE IF NOT EXISTS builtin_off (id TEXT PRIMARY KEY)');
    // ملفات مكتبة الميمز بعد ما تنزل
    this.sql.exec('CREATE TABLE IF NOT EXISTS lib_files (slug TEXT PRIMARY KEY, mime TEXT, size INTEGER, data BLOB, src TEXT, at INTEGER)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS lib_fail (slug TEXT PRIMARY KEY, err TEXT, tries INTEGER DEFAULT 0, at INTEGER)');
    // المايكات واللفلات والمتجر والباس والإعلانات
    this.eco = new Economy(this.sql);
    // أول مرة نشوف كل لاعب تيليجرام (إشعار «لاعب جديد» للأدمن)
    this.sql.exec('CREATE TABLE IF NOT EXISTS joins (uid TEXT PRIMARY KEY, at INTEGER, src TEXT)');
    if (!this.getKV('joins_seeded')) {
      // اللاعبين القدامى ما ينحسبون جدد بعد التحديث
      this.sql.exec("INSERT OR IGNORE INTO joins (uid, at, src) SELECT id, COALESCE(updated, 0), 'old' FROM users WHERE id LIKE 't%'");
      this.setKV('joins_seeded', '1');
    }
    // اللعب العشوائي: غرف عامة بغرفة الانتظار وبيها مكان
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS mm (
        code TEXT PRIMARY KEY, n INTEGER DEFAULT 0, phase TEXT DEFAULT 'lobby', ready INTEGER DEFAULT 0,
        held INTEGER DEFAULT 0, heldAt INTEGER DEFAULT 0, startsAt INTEGER DEFAULT 0, created INTEGER, at INTEGER)`,
    );
    const addCols = (table, cols) => {
      for (const c of cols) {
        try {
          this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${c}`);
        } catch {
          /* موجود */
        }
      }
    };
    // قائمة الغرف العامة: اسم المضيف واللاعبين
    addCols('mm', ["host TEXT DEFAULT ''", "players TEXT DEFAULT '[]'"]);
    // الأصوات اللي يضيفها اللاعبين: منو ضافها (اسمه يطلع ويا الصوت)
    addCols('sounds', ["by_uid TEXT DEFAULT ''", "by_name TEXT DEFAULT ''"]);
    // اللي حظروا البوت ما توصلهم الإذاعة
    addCols('joins', ['blocked INTEGER DEFAULT 0', "name TEXT DEFAULT ''"]);
    // لوحة المطوّر: الحظر، الأصوات المقترحة، إحصائيات الأيام
    this.sql.exec('CREATE TABLE IF NOT EXISTS banned (uid TEXT PRIMARY KEY, at INTEGER, reason TEXT, by TEXT)');
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS subs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, name TEXT, username TEXT, title TEXT, file_id TEXT, media TEXT,
        dur REAL DEFAULT 0, status TEXT DEFAULT 'pending', reason TEXT, created INTEGER, decided INTEGER, sound_id INTEGER, lang TEXT)`,
    );
    this.sql.exec('CREATE TABLE IF NOT EXISTS stats_day (day TEXT PRIMARY KEY, games INTEGER DEFAULT 0, plays INTEGER DEFAULT 0)');
    // الترتيب صار بأعمدة خاصة (lb_*): أول مرة ننسخ النقاط القديمة
    if (!this.getKV('lb_v1')) {
      this.sql.exec('UPDATE users SET lb_points = points, lb_wins = wins, lb_games = games, lb_best = best');
      this.setKV('lb_v1', '1');
    }
    this.sql.exec('CREATE INDEX IF NOT EXISTS users_lb ON users(lb_points DESC)');
  }

  /** يصحّي الـHub بعد ms (التنزيل والإذاعة يشتغلون بالخلفية بدفعات) — ما يأخّر منبّه أقرب */
  async kick(ms = 100) {
    const at = Date.now() + Math.max(50, ms);
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || cur > at) await this.ctx.storage.setAlarm(at);
  }

  /** يوم بتوقيت الأدمن (YYYY-MM-DD) للإحصائيات */
  dayKey(now = Date.now()) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: String(this.env.ADMIN_TZ || 'Asia/Baghdad').trim(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
    } catch {
      return new Date(now + 3 * 3600000).toISOString().slice(0, 10);
    }
  }

  /* ---------------- kv */
  getKV(k) {
    const row = this.sql.exec('SELECT v FROM kv WHERE k = ?', k).toArray()[0];
    return row ? row.v : null;
  }
  setKV(k, v) {
    this.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v));
    return true;
  }

  /* ---------------- اللاعبين والترتيب (أعمدة lb_* تتصفّر من لوحة المطوّر بدون ما تمس اللفلات) */
  me(uid) {
    const row = this.sql.exec('SELECT lb_games AS games, lb_wins AS wins, lb_points AS points, lb_best AS best FROM users WHERE id = ?', uid).toArray()[0];
    const stats = row || { games: 0, wins: 0, points: 0, best: 0 };
    const rank = row && row.games > 0 ? this.sql.exec('SELECT COUNT(*) AS c FROM users WHERE lb_points > ? AND lb_games > 0', row.points).one().c + 1 : null;
    return { ...stats, rank };
  }

  top(limit = 20) {
    return this.sql
      .exec(
        `SELECT id, name, photo, lb_games AS games, lb_wins AS wins, lb_points AS points, lb_best AS best FROM users
         WHERE lb_games > 0 AND id NOT IN (SELECT uid FROM banned) ORDER BY lb_points DESC LIMIT ?`,
        Math.min(50, limit),
      )
      .toArray();
  }

  /** results: [{uid, name, photo, score, guest}] → مكافآت كل لاعب تيليجرام */
  recordGame(results, winner, gkey = '') {
    const plays = results.filter((r) => !r.guest).length;
    this.sql.exec(
      'INSERT INTO stats_day (day, games, plays) VALUES (?, 1, ?) ON CONFLICT(day) DO UPDATE SET games = games + 1, plays = plays + excluded.plays',
      this.dayKey(),
      plays,
    );
    return this.eco.recordGame(results, winner, gkey);
  }

  /* ---------------- لوحة المطوّر: الحظر، الصيانة، الترتيب، الإحصائيات */

  isBanned(uid) {
    return !!this.sql.exec('SELECT 1 FROM banned WHERE uid = ?', String(uid)).toArray()[0];
  }

  /** للعامل: الصيانة والمحظورين (ينخزن بالذاكرة كم ثانية) */
  flags() {
    return { maint: this.getKV('maint') === '1', banned: this.sql.exec('SELECT uid FROM banned LIMIT 5000').toArray().map((r) => r.uid) };
  }

  ban(uid, reason = '', by = '') {
    uid = String(uid);
    if (!/^t\d+$/.test(uid)) return { ok: false };
    this.sql.exec('INSERT OR REPLACE INTO banned (uid, at, reason, by) VALUES (?, ?, ?, ?)', uid, Date.now(), String(reason || '').slice(0, 200), String(by || ''));
    return { ok: true, name: this.nameOf(uid) };
  }

  /** اسم اللاعب (من اللعبة، وإلا من أول مرة دخل البوت) */
  nameOf(uid) {
    const u = this.sql.exec('SELECT name FROM users WHERE id = ?', String(uid)).toArray()[0];
    if (u && u.name) return u.name;
    const j = this.sql.exec('SELECT name FROM joins WHERE uid = ?', String(uid)).toArray()[0];
    return (j && j.name) || '';
  }

  unban(uid) {
    return { ok: this.sql.exec('DELETE FROM banned WHERE uid = ?', String(uid)).rowsWritten > 0 };
  }

  bannedList(limit = 10) {
    return this.sql
      .exec(
        "SELECT b.uid, b.at, b.reason, COALESCE(NULLIF(u.name, ''), j.name, '') AS name FROM banned b LEFT JOIN users u ON u.id = b.uid LEFT JOIN joins j ON j.uid = b.uid ORDER BY b.at DESC LIMIT ?",
        limit,
      )
      .toArray();
  }

  setMaint(on) {
    this.setKV('maint', on ? '1' : '0');
    return on;
  }

  /** يصفّر المتصدرين بس (اللفلات والمايكات والمشتريات تبقى) */
  resetLeaderboard() {
    const n = this.sql.exec('SELECT COUNT(*) AS c FROM users WHERE lb_games > 0').one().c;
    this.sql.exec('UPDATE users SET lb_points = 0, lb_wins = 0, lb_games = 0, lb_best = 0');
    this.setKV('lb_reset_at', String(Date.now()));
    return { ok: true, n };
  }

  adminStats() {
    const now = Date.now();
    const day = now - 86400000;
    const week = now - 7 * 86400000;
    const one = (q, ...a) => this.sql.exec(q, ...a).one();
    const today = this.sql.exec('SELECT games, plays FROM stats_day WHERE day = ?', this.dayKey(now)).toArray()[0] || { games: 0, plays: 0 };
    const tot = one('SELECT COALESCE(SUM(games), 0) AS g FROM stats_day');
    const stars = one('SELECT COALESCE(SUM(stars), 0) AS s, COUNT(*) AS n FROM payments WHERE refunded = 0');
    const stars24 = one('SELECT COALESCE(SUM(stars), 0) AS s FROM payments WHERE refunded = 0 AND at >= ?', day);
    const c = this.soundCounts();
    return {
      users: one('SELECT COUNT(*) AS c FROM joins').c,
      new24: one("SELECT COUNT(*) AS c FROM joins WHERE at >= ? AND src <> 'old'", day).c,
      new7: one("SELECT COUNT(*) AS c FROM joins WHERE at >= ? AND src <> 'old'", week).c,
      active24: one('SELECT COUNT(*) AS c FROM users WHERE last_seen >= ?', day).c,
      players: one('SELECT COUNT(*) AS c FROM users WHERE games > 0').c,
      gamesToday: today.games,
      playsToday: today.plays,
      gamesTotal: tot.g,
      stars: stars.s,
      payments: stars.n,
      stars24: stars24.s,
      sounds: c.active,
      library: c.library.ready,
      custom: c.custom.total,
      subsPending: one("SELECT COUNT(*) AS c FROM subs WHERE status = 'pending'").c,
      rooms: this.mmStats(),
      banned: one('SELECT COUNT(*) AS c FROM banned').c,
      reach: one('SELECT COUNT(*) AS c FROM joins WHERE blocked = 0 AND uid NOT IN (SELECT uid FROM banned)').c,
      maint: this.getKV('maint') === '1',
      notify: this.getKV('notify_join') !== '0',
      bc: JSON.parse(this.getKV('bc_job') || 'null'),
    };
  }

  /* ---------------- الإذاعة: رسالة الأدمن تنسخ لكل اللاعبين بدفعات (حدود تيليجرام وCloudflare) */

  async startBroadcast({ from, msg, by }) {
    if (this.getKV('bc_job')) return { error: 'running' };
    const total = this.sql.exec('SELECT COUNT(*) AS c FROM joins WHERE blocked = 0 AND uid NOT IN (SELECT uid FROM banned)').one().c;
    this.setKV('bc_job', JSON.stringify({ from, msg, by: String(by || ''), cursor: 0, sent: 0, failed: 0, total, started: Date.now() }));
    await this.kick(150);
    return { ok: true, total };
  }

  cancelBroadcast() {
    const job = JSON.parse(this.getKV('bc_job') || 'null');
    this.sql.exec('DELETE FROM kv WHERE k = ?', 'bc_job');
    return { ok: !!job, job };
  }

  /** دفعة وحدة من الإذاعة. يرجع بعد كم ملي ثانية الدفعة الجاية (0 = خلصت) */
  async bcTick() {
    const job = JSON.parse(this.getKV('bc_job') || 'null');
    if (!job) return 0;
    const token = (this.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token) {
      this.sql.exec('DELETE FROM kv WHERE k = ?', 'bc_job');
      return 0;
    }
    const tg = new Tg(token, this.env.TG_API_BASE);
    const batch = Math.max(1, Math.min(25, Number(this.env.BC_BATCH) || 20));
    const rows = this.sql
      .exec('SELECT rowid AS r, uid FROM joins WHERE rowid > ? AND blocked = 0 AND uid NOT IN (SELECT uid FROM banned) ORDER BY rowid LIMIT ?', job.cursor, batch)
      .toArray();
    let wait = Math.max(300, Number(this.env.BC_GAP_MS) || 1100);
    for (const r of rows) {
      try {
        await tg.call('copyMessage', { chat_id: Number(String(r.uid).slice(1)), from_chat_id: job.from, message_id: job.msg });
        job.sent++;
      } catch (e) {
        const m = String((e && e.message) || e);
        const retry = /retry after (\d+)/i.exec(m);
        if (retry || /Too Many Requests/i.test(m)) {
          wait = (retry ? Number(retry[1]) : 3) * 1000 + 300;
          break; // نفس اللاعب نعيده بالدفعة الجاية
        }
        job.failed++;
        // حاظر البوت أو ما بدا وياه أصلًا (فتح اللعبة بس): ما نحاول وياه مرة ثانية
        if (/blocked|deactivated|chat not found|initiate|user is deactivated|PEER_ID_INVALID|Forbidden/i.test(m)) this.sql.exec('UPDATE joins SET blocked = 1 WHERE uid = ?', r.uid);
      }
      job.cursor = r.r;
    }
    if (!rows.length) {
      // خلصت: تقرير للأدمن اللي بداها
      this.sql.exec('DELETE FROM kv WHERE k = ?', 'bc_job');
      const secs = Math.round((Date.now() - job.started) / 1000);
      const text = ['‏📢 خلصت الإذاعة', `‏✅ وصلت: ${job.sent}`, `‏❌ ما وصلت: ${job.failed} (حاظرين البوت أو ما بدوا وياه)`, `‏⏱️ ${secs} ثانية`].join('\n');
      const to = job.by ? [job.by] : adminIds(this.env);
      for (const id of to) await tg.call('sendMessage', { chat_id: id, text }).catch(() => null);
      return 0;
    }
    this.setKV('bc_job', JSON.stringify(job));
    return wait;
  }

  /* ---------------- أصوات يقترحها اللاعبين (البوت يستلمها والأدمن يقبل أو يرفض) */

  /** يكدر يقترح هسه؟ (حد الانتظار وحد اليوم) */
  subCheck(uid) {
    const pending = this.sql.exec("SELECT COUNT(*) AS c FROM subs WHERE uid = ? AND status = 'pending'", uid).one().c;
    if (pending >= 3) return { ok: false, error: 'pending' };
    const today = this.sql.exec('SELECT COUNT(*) AS c FROM subs WHERE uid = ? AND created >= ?', uid, Date.now() - 86400000).one().c;
    if (today >= 10) return { ok: false, error: 'daily' };
    return { ok: true };
  }

  addSub({ uid, name, username, title, file_id, media, dur, lang }) {
    this.sql.exec(
      'INSERT INTO subs (uid, name, username, title, file_id, media, dur, status, created, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      String(uid),
      String(name || '').slice(0, 64),
      String(username || '').slice(0, 40),
      String(title || '').slice(0, 40),
      String(file_id),
      String(media || 'audio'),
      Number(dur) || 0,
      'pending',
      Date.now(),
      String(lang || ''),
    );
    return this.sql.exec('SELECT last_insert_rowid() AS id').one().id;
  }

  sub(id) {
    return this.sql.exec('SELECT * FROM subs WHERE id = ?', Number(id)).toArray()[0] || null;
  }

  pendingSubs(limit = 5) {
    return this.sql.exec("SELECT * FROM subs WHERE status = 'pending' ORDER BY id LIMIT ?", limit).toArray();
  }

  /**
   * قبول صوت مقترح: ينضاف للعبة (الصوت بس — حتى لو فيديو)، وياه صورة اللي ضافه واسمه، وياخذ 50 مايك و50 خبرة باس.
   */
  approveSub(id, imgFileId = '') {
    const s = this.sub(id);
    if (!s) return { ok: false, error: 'notfound' };
    if (s.status !== 'pending') return { ok: false, error: 'done', sub: s };
    const now = Date.now();
    this.sql.exec(
      'INSERT INTO sounds (title, file_id, kind, img_file_id, dur, added_by, created, by_uid, by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      s.title,
      s.file_id,
      'audio',
      imgFileId || null,
      s.dur || 0,
      s.uid,
      now,
      s.uid,
      s.name || '',
    );
    const soundId = this.sql.exec('SELECT last_insert_rowid() AS id').one().id;
    this.sql.exec("UPDATE subs SET status = 'approved', decided = ?, sound_id = ? WHERE id = ?", now, soundId, s.id);
    this.eco.ensureUser(s.uid, s.name || '');
    this.eco.addMics(s.uid, 50);
    const pass = this.eco.addPassXp(s.uid, 50, now);
    return { ok: true, sub: { ...s, status: 'approved' }, soundId, pass };
  }

  rejectSub(id, reason = '') {
    const s = this.sub(id);
    if (!s) return { ok: false, error: 'notfound' };
    if (s.status !== 'pending') return { ok: false, error: 'done', sub: s };
    this.sql.exec("UPDATE subs SET status = 'rejected', decided = ?, reason = ? WHERE id = ?", Date.now(), String(reason || '').slice(0, 300), s.id);
    return { ok: true, sub: { ...s, status: 'rejected', reason } };
  }

  /* ---------------- لاعبين جدد (إشعار للأدمن) */

  /**
   * أول مرة نشوف لاعب تيليجرام (من البوت أو من اللعبة): ينحفظ ويوصل للأدمن إشعار بمعلوماته.
   * u: {id, first_name, last_name, username, language_code, is_premium, src}
   */
  async join(u) {
    if (!u || !u.id) return { isNew: false };
    const uid = 't' + Number(u.id);
    const now = Date.now();
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim().slice(0, 64);
    const r = this.sql.exec('INSERT OR IGNORE INTO joins (uid, at, src, name) VALUES (?, ?, ?, ?)', uid, now, String(u.src || '').slice(0, 80), name);
    if (!r.rowsWritten) {
      // رجع يحچي ويا البوت: توصله الإذاعة مرة ثانية
      if (u.fromBot) this.sql.exec('UPDATE joins SET blocked = 0 WHERE uid = ? AND blocked = 1', uid);
      return { isNew: false };
    }
    const n = this.sql.exec('SELECT COUNT(*) AS c FROM joins').one().c;
    if (this.getKV('notify_join') !== '0') await this.notifyJoin(u, n, now).catch((e) => console.log('notifyJoin', e && e.message));
    return { isNew: true, n };
  }

  joinStats() {
    const day = Date.now() - 86400000;
    return {
      total: this.sql.exec('SELECT COUNT(*) AS c FROM joins').one().c,
      today: this.sql.exec("SELECT COUNT(*) AS c FROM joins WHERE at >= ? AND src <> 'old'", day).one().c,
      on: this.getKV('notify_join') !== '0',
    };
  }

  setJoinNotify(on) {
    this.setKV('notify_join', on ? '1' : '0');
    return this.joinStats();
  }

  async notifyJoin(u, n, now) {
    const token = (this.env.TELEGRAM_BOT_TOKEN || '').trim();
    const admins = adminIds(this.env);
    if (!token || !admins.length) return;
    // ضد السبام: لحد 12 إشعار بالدقيقة، والزايد ينذكر بأول إشعار بالدقيقة اللي بعدها
    const win = JSON.parse(this.getKV('join_win') || 'null') || { t: 0, n: 0, skip: 0 };
    let carried = 0;
    if (now - win.t >= 60000) {
      carried = win.skip || 0;
      win.t = now;
      win.n = 0;
      win.skip = 0;
    }
    if (win.n >= 12) {
      win.skip = (win.skip || 0) + 1;
      this.setKV('join_win', JSON.stringify(win));
      return;
    }
    win.n += 1;
    this.setKV('join_win', JSON.stringify(win));
    const h = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || 'بدون اسم';
    let when = '';
    try {
      when = new Intl.DateTimeFormat('en-GB', {
        timeZone: String(this.env.ADMIN_TZ || 'Asia/Baghdad').trim(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(now));
    } catch {
      when = new Date(now).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    }
    const text = [
      `🆕 لاعب جديد — رقم ${n}`,
      `👤 <a href="tg://user?id=${Number(u.id)}">${h(name)}</a>${u.username ? ' · @' + h(u.username) : ''}`,
      `🆔 <code>${Number(u.id)}</code>`,
      `🌐 اللغة: ${h(u.language_code) || '—'}${u.is_premium ? ' · ⭐ بريميوم' : ''}`,
      `📲 دخل من: ${h(u.src) || '—'}`,
      `🕒 ${when}`,
      carried ? `➕ وقبله ${carried} لاعب جديد ما وصلك إشعارهم (زحمة)` : '',
    ]
      .filter(Boolean)
      .map((l) => '‏' + l)
      .join('\n');
    const tg = new Tg(token, this.env.TG_API_BASE);
    for (const id of admins) await tg.call('sendMessage', { chat_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true }).catch(() => null);
  }

  /* ---------------- اللعب العشوائي: غرف عامة يدخلها أي واحد */

  /**
   * يلگي غرفة عامة بغرفة الانتظار وبيها مكان (الأملى أول حتى اللعبة تبدي أسرع).
   * exclude: غرف ما زبطت ويا اللاعب هسه، bad: غرفة طلعت مو موجودة (تنشال).
   * يرجع {code} أو {code: null} = سوّوا غرفة جديدة.
   */
  quickRoom(exclude = [], bad = '') {
    const now = Date.now();
    if (bad) this.sql.exec('DELETE FROM mm WHERE code = ?', String(bad));
    this.sql.exec('DELETE FROM mm WHERE at < ?', now - 30 * 60 * 1000);
    const ex = new Set((exclude || []).map(String));
    const rows = this.sql
      .exec("SELECT code, n, held, heldAt, startsAt FROM mm WHERE ready = 1 AND phase = 'lobby' ORDER BY n DESC, created ASC LIMIT 30")
      .toArray();
    for (const r of rows) {
      if (ex.has(r.code)) continue;
      const held = r.heldAt > now - 8000 ? r.held : 0;
      if (r.n + held >= MAX_PLAYERS) continue;
      if (r.startsAt && r.startsAt - now < 2500) continue; // على وشك تبدي
      this.sql.exec('UPDATE mm SET held = ?, heldAt = ? WHERE code = ?', held + 1, now, r.code);
      return { code: r.code };
    }
    return { code: null };
  }

  /** غرفة عامة جديدة انحجزت للاعب (هو أول واحد بيها) */
  mmAdd(code) {
    const now = Date.now();
    this.sql.exec(
      "INSERT OR REPLACE INTO mm (code, n, phase, ready, held, heldAt, startsAt, created, at) VALUES (?, 0, 'lobby', 1, 1, ?, 0, ?, ?)",
      String(code),
      now,
      now,
      now,
    );
    return true;
  }

  /** الغرفة العامة تبلّغ حالتها (وأسماء اللي بيها للقائمة). n = 0 أو phase = gone: تنشال من القائمة */
  mmReport(code, { n = 0, phase = 'lobby', startsAt = 0, host = '', players = [] } = {}) {
    const now = Date.now();
    if (!n || phase === 'gone') {
      this.sql.exec('DELETE FROM mm WHERE code = ?', String(code));
      return true;
    }
    const list = JSON.stringify(
      (Array.isArray(players) ? players : []).slice(0, MAX_PLAYERS).map((p) => ({ n: String((p && p.n) || '').slice(0, 18), s: Number(p && p.s) || 0 })),
    );
    // كل لاعب دخل فعلًا يفك حجز واحد
    this.sql.exec(
      `INSERT INTO mm (code, n, phase, ready, held, heldAt, startsAt, created, at, host, players) VALUES (?, ?, ?, 1, 0, 0, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET held = MAX(0, mm.held - MAX(0, excluded.n - mm.n)), n = excluded.n, phase = excluded.phase,
         ready = 1, startsAt = excluded.startsAt, at = excluded.at, host = excluded.host, players = excluded.players`,
      String(code),
      Number(n) || 0,
      String(phase),
      Number(startsAt) || 0,
      now,
      now,
      String(host || '').slice(0, 18),
      list,
    );
    return true;
  }

  /** قائمة الغرف العامة للي يدورون: اللي تنتظر أول (الأملى فوق)، وبعدها اللي بنص لعبة */
  mmList() {
    const now = Date.now();
    this.sql.exec('DELETE FROM mm WHERE at < ?', now - 30 * 60 * 1000);
    return this.sql
      .exec(
        `SELECT code, n, phase, startsAt, host, players FROM mm WHERE n > 0
         ORDER BY CASE WHEN phase = 'lobby' THEN 0 ELSE 1 END, n DESC, created ASC LIMIT 40`,
      )
      .toArray()
      .map((r) => {
        let players = [];
        try {
          players = JSON.parse(r.players || '[]');
        } catch {
          /* */
        }
        return { code: r.code, n: r.n, phase: r.phase, startsAt: r.startsAt || 0, host: r.host || '', players };
      });
  }

  /** كم واحد ينتظر بالغرف العامة هسه */
  mmStats() {
    const r = this.sql.exec("SELECT COUNT(*) AS rooms, COALESCE(SUM(n), 0) AS waiting FROM mm WHERE phase = 'lobby' AND at > ?", Date.now() - 30 * 60 * 1000).one();
    return { rooms: r.rooms, waiting: r.waiting };
  }

  /** للبوت: اسم البوت، لغة اللاعب باللعبة، الحظر والصيانة، وخطوات المحادثة (اقتراح صوت / خطوات الأدمن) */
  botInfo(uid, isAdmin = false) {
    const st = (k) => {
      const v = JSON.parse(this.getKV(k) || 'null');
      // الخطوة تنتهي بعد ربع ساعة
      if (v && Date.now() - (v.at || 0) > 15 * 60 * 1000) {
        this.delKV(k);
        return null;
      }
      return v;
    };
    return {
      bot: this.getKV('bot'),
      lang: uid ? this.eco.langOf(uid) : '',
      banned: uid ? this.isBanned(uid) : false,
      maint: this.getKV('maint') === '1',
      sub: uid ? st('sub:' + uid) : null,
      adm: isAdmin && uid ? st('adm:' + uid) : null,
    };
  }

  delKV(k) {
    this.sql.exec('DELETE FROM kv WHERE k = ?', k);
    return true;
  }

  /* ---------------- الاقتصاد (RPC للعامل والغرف) */
  profile(uid, name = '', photo = '', lang = '') {
    this.eco.ensureUser(uid, name, photo, lang);
    return this.eco.profile(uid);
  }
  buy(uid, item) {
    return this.eco.buy(uid, item);
  }
  equip(uid, slot, item) {
    return this.eco.equip(uid, slot, item);
  }
  lookOf(uid) {
    return this.eco.lookOf(uid);
  }
  adIntent(uid, kind, item) {
    this.eco.ensureUser(uid);
    return this.eco.adIntent(uid, kind, item);
  }
  adReward(uid, nonce = null) {
    return this.eco.adReward(uid, nonce);
  }
  adStatus(uid, nonce) {
    return this.eco.adStatus(uid, nonce);
  }
  canBuyPass(uid, season) {
    return this.eco.canBuyPass(uid, season);
  }
  grantPremium(uid, season, charge, stars) {
    return this.eco.grantPremium(uid, season, charge, stars);
  }
  canBuyPack(uid, sku, season) {
    return this.eco.canBuyPack(uid, sku, season);
  }
  grantPack(uid, sku, season, charge, stars) {
    return this.eco.grantPack(uid, sku, season, charge, stars);
  }
  paymentByCharge(charge) {
    return this.eco.paymentByCharge(charge);
  }
  refundPayment(charge) {
    return this.eco.markRefunded(charge);
  }

  /* ---------------- الأصوات */
  addSound({ title, file_id, kind, dur, added_by }) {
    this.sql.exec(
      'INSERT INTO sounds (title, file_id, kind, dur, added_by, created) VALUES (?, ?, ?, ?, ?, ?)',
      title || '',
      file_id,
      kind || 'audio',
      Number(dur) || 0,
      added_by || '',
      Date.now(),
    );
    const id = this.sql.exec('SELECT last_insert_rowid() AS id').one().id;
    if (!title) this.sql.exec('UPDATE sounds SET title = ? WHERE id = ?', 'صوت #' + id, id);
    return id;
  }
  setSoundImage(id, fileId) {
    this.sql.exec('UPDATE sounds SET img_file_id = ? WHERE id = ?', fileId, id);
    return true;
  }
  listSounds() {
    return this.sql.exec('SELECT id, title, kind, img_file_id, active, plays FROM sounds ORDER BY id').toArray();
  }
  delSound(id) {
    return this.sql.exec('DELETE FROM sounds WHERE id = ?', id).rowsWritten > 0;
  }

  builtinOff() {
    return new Set(this.sql.exec('SELECT id FROM builtin_off').toArray().map((r) => r.id));
  }

  /** كل الأصوات (المضافة + المكتبة + النظام) مع حالتها — لقائمة الأدمن بالبوت. */
  listAll() {
    const off = this.builtinOff();
    const ready = this.libReady();
    const builtin = BUILTIN_SOUNDS.map((b) => ({ key: b.id, title: b.title, emoji: b.emoji, kind: 'builtin', active: !off.has(b.id) }));
    const lib = LIBRARY_SOUNDS.filter((x) => ready.has(x.slug)).map((x) => ({
      key: 'm:' + x.slug,
      title: x.title,
      emoji: x.emoji,
      kind: 'library',
      active: !off.has('m:' + x.slug),
    }));
    const custom = this.sql
      .exec('SELECT id, title, kind, img_file_id, active FROM sounds ORDER BY id')
      .toArray()
      .map((c) => ({ key: 'c:' + c.id, title: c.title, emoji: c.kind === 'video' ? '🎬' : c.img_file_id ? '🖼️' : '🎙️', kind: 'custom', active: !!c.active }));
    return [...custom, ...lib, ...builtin];
  }

  /** عنوان صوت من النظام أو المكتبة (null إذا المفتاح غلط) */
  systemTitle(key) {
    if (key.startsWith('b:')) {
      const b = BUILTIN_SOUNDS.find((x) => x.id === key);
      return b ? b.title : null;
    }
    if (key.startsWith('m:')) {
      const m = LIBRARY_BY_SLUG.get(key.slice(2));
      return m ? m.title : null;
    }
    return null;
  }

  /** تفعيل/تعطيل صوت. يرجع {title, active} أو null. */
  toggleSound(key) {
    if (key.startsWith('b:') || key.startsWith('m:')) {
      const title = this.systemTitle(key);
      if (!title) return null;
      const off = this.builtinOff().has(key);
      if (off) this.sql.exec('DELETE FROM builtin_off WHERE id = ?', key);
      else this.sql.exec('INSERT OR IGNORE INTO builtin_off (id) VALUES (?)', key);
      return { title, active: off };
    }
    if (key.startsWith('c:')) {
      const id = Number(key.slice(2));
      const row = this.sql.exec('SELECT title, active FROM sounds WHERE id = ?', id).toArray()[0];
      if (!row) return null;
      this.sql.exec('UPDATE sounds SET active = ? WHERE id = ?', row.active ? 0 : 1, id);
      return { title: row.title, active: !row.active };
    }
    return null;
  }

  /** حذف نهائي لصوت مضاف. أصوات النظام تنعطل بس (ملفاتها جزء من اللعبة). */
  deleteSound(key) {
    if (key.startsWith('c:')) {
      const id = Number(key.slice(2));
      const row = this.sql.exec('SELECT title FROM sounds WHERE id = ?', id).toArray()[0];
      if (!row) return null;
      this.sql.exec('DELETE FROM sounds WHERE id = ?', id);
      return { title: row.title, deleted: true };
    }
    if (key.startsWith('b:') || key.startsWith('m:')) {
      const title = this.systemTitle(key);
      if (!title) return null;
      this.sql.exec('INSERT OR IGNORE INTO builtin_off (id) VALUES (?)', key);
      return { title, deleted: false };
    }
    return null;
  }

  /** تعطيل/تفعيل كل أصوات النظام والمكتبة مرة وحدة */
  setBuiltinAll(active) {
    if (active) this.sql.exec('DELETE FROM builtin_off');
    else {
      for (const b of BUILTIN_SOUNDS) this.sql.exec('INSERT OR IGNORE INTO builtin_off (id) VALUES (?)', b.id);
      for (const m of LIBRARY_SOUNDS) this.sql.exec('INSERT OR IGNORE INTO builtin_off (id) VALUES (?)', 'm:' + m.slug);
    }
    return true;
  }
  renameSound(id, title) {
    return this.sql.exec('UPDATE sounds SET title = ? WHERE id = ?', title, id).rowsWritten > 0;
  }

  /** يختار n أصوات عشوائية: المدمجة + المضافة (المضافة وزنها أعلى). */
  pickSounds(n) {
    const mode = String(this.env.SOUND_MODE || 'mix');
    const custom = this.sql
      .exec('SELECT id, title, file_id, kind, img_file_id, dur, by_name FROM sounds WHERE active = 1')
      .toArray()
      .map((c) => ({
        id: 'c:' + c.id,
        title: c.title,
        url: '/tgfile/' + c.file_id,
        img: c.img_file_id ? '/tgfile/' + c.img_file_id : '',
        video: c.kind === 'video',
        emoji: c.by_name ? '🎙️' : '🎭',
        color: '#ff4f8b',
        dur: c.dur || 0,
        // صوت ضافه لاعب: اسمه يطلع ويا الصوت
        by: c.by_name || '',
        w: 3,
      }));
    let pool = custom;
    const off = this.builtinOff();
    const ready = this.libReady();
    const builtin = BUILTIN_SOUNDS.filter((b) => !off.has(b.id)).map((b) => ({ ...b, img: '', video: false, w: 1 }));
    const lib = LIBRARY_SOUNDS.filter((m) => ready.has(m.slug) && !off.has('m:' + m.slug)).map((m) => ({
      id: 'm:' + m.slug,
      title: m.title,
      url: '/lib/' + m.slug + '.mp3',
      img: '',
      video: false,
      emoji: m.emoji,
      color: '#ff4f8b',
      dur: 0,
      w: 1,
    }));
    if (mode !== 'custom' || custom.length < n) pool = [...pool, ...lib, ...builtin];
    const out = [];
    const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    while (out.length < n && pool.length) {
      const total = pool.reduce((s, p) => s + p.w, 0);
      let r = rnd() * total;
      let i = 0;
      for (; i < pool.length - 1; i++) {
        r -= pool[i].w;
        if (r <= 0) break;
      }
      const [pick] = pool.splice(i, 1);
      const { w, ...rest } = pick;
      out.push(rest);
    }
    const ids = out.filter((s) => s.id.startsWith('c:')).map((s) => Number(s.id.slice(2)));
    for (const id of ids) this.sql.exec('UPDATE sounds SET plays = plays + 1 WHERE id = ?', id);
    return out;
  }

  /* ---------------- مكتبة الميمز (تنزل على Cloudflare وتنحفظ هنا) */
  libReady() {
    return new Set(this.sql.exec('SELECT slug FROM lib_files').toArray().map((r) => r.slug));
  }

  libFailed() {
    return new Map(this.sql.exec('SELECT slug, tries, err FROM lib_fail').toArray().map((r) => [r.slug, r]));
  }

  /** الأصوات اللي بعدها ما نزلت وتستاهل محاولة */
  libPending() {
    const ready = this.libReady();
    const fails = this.libFailed();
    return LIBRARY_SOUNDS.filter((m) => !ready.has(m.slug) && (fails.has(m.slug) ? fails.get(m.slug).tries : 0) < LIB_MAX_TRIES);
  }

  libFile(slug) {
    const r = this.sql.exec('SELECT mime, data FROM lib_files WHERE slug = ?', slug).toArray()[0];
    return r ? { mime: r.mime, data: r.data } : null;
  }

  /** يبدي تنزيل أصوات المكتبة الناقصة بالخلفية (دفعات صغيرة حتى تبقى ضمن حدود الخطة المجانية). */
  async ensureLibrary({ notify = true } = {}) {
    const pending = this.libPending().length;
    if (!pending) return { ok: true, pending: 0 };
    const job = JSON.parse(this.getKV('lib_job') || 'null');
    if (job && Date.now() - job.beat < 120000) return { ok: true, pending, running: true };
    this.setKV('lib_job', JSON.stringify({ started: Date.now(), beat: Date.now(), notify, ok: 0 }));
    await this.kick(100);
    return { ok: true, pending, started: true };
  }

  /** زر «أعد تحميل اللي فشلت» */
  async retryLibrary() {
    this.sql.exec('DELETE FROM lib_fail');
    return this.ensureLibrary({ notify: true });
  }

  /** المنبّه الواحد يشغّل الشغلتين بالخلفية: تنزيل المكتبة والإذاعة، وكل وحدة تكول متى ترجع */
  async alarm() {
    const waits = [];
    for (const step of [() => this.libTick(), () => this.bcTick()]) {
      try {
        const ms = await step();
        if (ms > 0) waits.push(ms);
      } catch (e) {
        console.log('alarm step failed', e && e.message);
      }
    }
    if (waits.length) await this.ctx.storage.setAlarm(Date.now() + Math.min(...waits));
  }

  /** دفعة من تنزيل المكتبة. يرجع بعد كم ملي ثانية الجاية (0 = ماكو شي) */
  async libTick() {
    const job = JSON.parse(this.getKV('lib_job') || 'null');
    if (!job) return 0;
    const batch = this.libPending().slice(0, Math.max(1, Number(this.env.LIB_BATCH) || 4));
    for (const m of batch) {
      try {
        const f = await fetchLibrarySound(this.env, m.slug);
        this.sql.exec(
          'INSERT OR REPLACE INTO lib_files (slug, mime, size, data, src, at) VALUES (?, ?, ?, ?, ?, ?)',
          m.slug,
          f.mime,
          f.data.byteLength,
          f.data,
          f.src,
          Date.now(),
        );
        this.sql.exec('DELETE FROM lib_fail WHERE slug = ?', m.slug);
        job.ok++;
      } catch (e) {
        this.sql.exec(
          `INSERT INTO lib_fail (slug, err, tries, at) VALUES (?, ?, 1, ?)
           ON CONFLICT(slug) DO UPDATE SET err = excluded.err, tries = tries + 1, at = excluded.at`,
          m.slug,
          String((e && e.message) || e).slice(0, 200),
          Date.now(),
        );
      }
    }
    job.beat = Date.now();
    if (this.libPending().length) {
      this.setKV('lib_job', JSON.stringify(job));
      return Math.max(100, Number(this.env.LIB_GAP_MS) || 1200);
    }
    this.sql.exec('DELETE FROM kv WHERE k = ?', 'lib_job');
    if (job.notify) await this.notifyLibraryDone(job.ok);
    return 0;
  }

  async notifyLibraryDone(added) {
    const token = (this.env.TELEGRAM_BOT_TOKEN || '').trim();
    const admins = adminIds(this.env);
    if (!token || !admins.length) return;
    const c = this.soundCounts();
    const fails = this.libFailed();
    const failed = LIBRARY_SOUNDS.filter((m) => fails.has(m.slug) && fails.get(m.slug).tries >= LIB_MAX_TRIES);
    if (!added && !failed.length) return;
    const failedTitles = failed.map((m) => m.title);
    const text = [
      added ? `🎌 انضاف للعبة ${added} صوت جديد من مكتبة الميمز` : '❌ ما كدرت أنزّل أصوات مكتبة الميمز من myinstants',
      `✅ الأصوات الفعّالة هسه: ${c.active}`,
      failed.length ? `❌ ما نزلت (${failed.length}): ${failedTitles.slice(0, 8).join('، ')}${failed.length > 8 ? '…' : ''}` : '',
      !added && failed.length ? `السبب: ${fails.get(failed[0].slug).err}` : '',
      failed.length ? 'تكدر تعيد المحاولة من زر 🔄 بـ/sounds' : 'تكدر تعطّل أو تحذف أي صوت من /sounds',
    ]
      .filter(Boolean)
      .map((l) => '\u200f' + l)
      .join('\n');
    const tg = new Tg(token, this.env.TG_API_BASE);
    for (const id of admins) await tg.call('sendMessage', { chat_id: id, text }).catch(() => null);
  }

  /** أعداد الأصوات: الفعّالة + تفصيل حسب النوع */
  soundCounts() {
    const off = this.builtinOff();
    const ready = this.libReady();
    const fails = this.libFailed();
    const cust = this.sql.exec('SELECT COUNT(*) AS c, COALESCE(SUM(active), 0) AS a FROM sounds').one();
    const builtinOn = BUILTIN_SOUNDS.filter((b) => !off.has(b.id)).length;
    const libReady = LIBRARY_SOUNDS.filter((m) => ready.has(m.slug));
    const libOn = libReady.filter((m) => !off.has('m:' + m.slug)).length;
    const failed = LIBRARY_SOUNDS.filter((m) => !ready.has(m.slug) && fails.has(m.slug) && fails.get(m.slug).tries >= LIB_MAX_TRIES).length;
    const pending = LIBRARY_SOUNDS.length - libReady.length - failed;
    const job = JSON.parse(this.getKV('lib_job') || 'null');
    return {
      active: builtinOn + libOn + Number(cust.a),
      builtin: { on: builtinOn, total: BUILTIN_SOUNDS.length },
      library: { on: libOn, ready: libReady.length, total: LIBRARY_SOUNDS.length, pending, failed, running: !!job },
      custom: { on: Number(cust.a), total: Number(cust.c) },
    };
  }

  /* ---------------- ربط البوت بتيليجرام */
  async ensureWebhook(origin, force = false) {
    const token = (this.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token) return { ok: false, reason: 'TELEGRAM_BOT_TOKEN غير مضبوط' };
    const digest = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))).slice(0, 12);
    const stamp = `${origin}|${digest}|v8`;
    if (!force && this.getKV('webhook') === stamp) return { ok: true, cached: true, bot: this.getKV('bot') };
    const tg = new Tg(token, this.env.TG_API_BASE);
    try {
      const me = await tg.call('getMe');
      this.setKV('bot', me.username);
      await tg.call('setWebhook', {
        url: origin + '/api/telegram/webhook',
        secret_token: await webhookSecret(token),
        allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
      });
      const ar = [
        { command: 'start', description: 'ابدأ' },
        { command: 'play', description: 'سوّي غرفة لعب' },
        { command: 'pass', description: 'الرويال باس المميز ⭐' },
        { command: 'top', description: 'المتصدرين' },
        { command: 'addsound', description: 'ضيف صوتك للعبة 🎙️' },
        { command: 'sounds', description: 'كم صوت شغّال باللعبة' },
        { command: 'help', description: 'المساعدة' },
      ];
      await tg.call('setMyCommands', { commands: ar });
      // نفس الأوامر بلغة تطبيق اللاعب (تيليجرام يختار حسب لغته)
      const ru = [
        { command: 'start', description: 'Начать' },
        { command: 'play', description: 'Создать комнату' },
        { command: 'pass', description: 'Премиум-пропуск ⭐' },
        { command: 'top', description: 'Лидеры' },
        { command: 'addsound', description: 'Добавить свой звук 🎙️' },
        { command: 'sounds', description: 'Сколько звуков в игре' },
        { command: 'help', description: 'Помощь' },
      ];
      const en = [
        { command: 'start', description: 'Start' },
        { command: 'play', description: 'Create a game room' },
        { command: 'pass', description: 'Premium Royal Pass ⭐' },
        { command: 'top', description: 'Leaderboard' },
        { command: 'addsound', description: 'Add your own sound 🎙️' },
        { command: 'sounds', description: 'Active sounds in the game' },
        { command: 'help', description: 'Help' },
      ];
      for (const [language_code, commands] of [
        ['ru', ru],
        ['uk', ru],
        ['en', en],
      ]) {
        await tg.call('setMyCommands', { commands, language_code }).catch(() => null);
      }
      // الأدمن بس يشوف أمر لوحة المطوّر
      for (const a of adminIds(this.env).slice(0, 5)) {
        await tg
          .call('setMyCommands', {
            commands: [{ command: 'admin', description: 'لوحة المطوّر 🛠️' }, ...ar],
            scope: { type: 'chat', chat_id: Number(a) },
          })
          .catch(() => null);
      }
      await tg
        .call('setChatMenuButton', { menu_button: { type: 'web_app', text: '🎮 العب', web_app: { url: origin + '/' } } })
        .catch(() => null);
      this.setKV('webhook', stamp);
      this.setKV('webhook_at', new Date().toISOString());
      this.sql.exec('DELETE FROM kv WHERE k = ?', 'webhook_error');
      return { ok: true, bot: me.username };
    } catch (e) {
      this.setKV('webhook_error', String(e.message || e));
      return { ok: false, reason: String(e.message || e) };
    }
  }

  status() {
    const c = this.soundCounts();
    return {
      webhook: this.getKV('webhook_at') || 'لم يُسجَّل بعد',
      webhookError: this.getKV('webhook_error') || null,
      bot: this.getKV('bot'),
      soundsActive: c.active,
      sounds: c.custom.on,
      builtinOn: c.builtin.on,
      library: c.library,
      players: this.sql.exec('SELECT COUNT(*) AS c FROM users').one().c,
    };
  }
}
