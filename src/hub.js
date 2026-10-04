// الكائن المركزي: اللاعبين والترتيب، الأصوات المضافة من البوت، وإعدادات الـwebhook.

import { DurableObject } from 'cloudflare:workers';
import { BUILTIN_SOUNDS } from './builtin-sounds.js';
import { LIBRARY_SOUNDS, LIBRARY_BY_SLUG } from './library-sounds.js';
import { fetchLibrarySound } from './myinstants.js';
import { Tg, adminIds } from './telegram.js';
import { webhookSecret, toHex } from './auth.js';
import { Economy } from './economy.js';

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

  /* ---------------- اللاعبين */
  me(uid) {
    const row = this.sql.exec('SELECT games, wins, points, best FROM users WHERE id = ?', uid).toArray()[0];
    const stats = row || { games: 0, wins: 0, points: 0, best: 0 };
    const rank = row ? this.sql.exec('SELECT COUNT(*) AS c FROM users WHERE points > ?', row.points).one().c + 1 : null;
    return { ...stats, rank };
  }

  top(limit = 20) {
    return this.sql
      .exec('SELECT id, name, photo, games, wins, points, best FROM users WHERE games > 0 ORDER BY points DESC LIMIT ?', Math.min(50, limit))
      .toArray();
  }

  /** results: [{uid, name, photo, score, guest}] → مكافآت كل لاعب تيليجرام */
  recordGame(results, winner, gkey = '') {
    return this.eco.recordGame(results, winner, gkey);
  }

  /* ---------------- الاقتصاد (RPC للعامل والغرف) */
  profile(uid, name = '', photo = '') {
    this.eco.ensureUser(uid, name, photo);
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
      .exec('SELECT id, title, file_id, kind, img_file_id, dur FROM sounds WHERE active = 1')
      .toArray()
      .map((c) => ({
        id: 'c:' + c.id,
        title: c.title,
        url: '/tgfile/' + c.file_id,
        img: c.img_file_id ? '/tgfile/' + c.img_file_id : '',
        video: c.kind === 'video',
        emoji: '🎭',
        color: '#ff4f8b',
        dur: c.dur || 0,
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
    await this.ctx.storage.setAlarm(Date.now() + 100);
    return { ok: true, pending, started: true };
  }

  /** زر «أعد تحميل اللي فشلت» */
  async retryLibrary() {
    this.sql.exec('DELETE FROM lib_fail');
    return this.ensureLibrary({ notify: true });
  }

  async alarm() {
    const job = JSON.parse(this.getKV('lib_job') || 'null');
    if (!job) return;
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
      await this.ctx.storage.setAlarm(Date.now() + Math.max(100, Number(this.env.LIB_GAP_MS) || 1200));
      return;
    }
    this.sql.exec('DELETE FROM kv WHERE k = ?', 'lib_job');
    if (job.notify) await this.notifyLibraryDone(job.ok);
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
    const stamp = `${origin}|${digest}|v6`;
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
      await tg.call('setMyCommands', {
        commands: [
          { command: 'start', description: 'ابدأ' },
          { command: 'play', description: 'سوّي غرفة لعب' },
          { command: 'pass', description: 'الرويال باس المميز ⭐' },
          { command: 'top', description: 'المتصدرين' },
          { command: 'sounds', description: 'كم صوت شغّال باللعبة' },
          { command: 'help', description: 'المساعدة' },
        ],
      });
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
