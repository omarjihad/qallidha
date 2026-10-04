// الكائن المركزي: اللاعبين والترتيب، الأصوات المضافة من البوت، وإعدادات الـwebhook.

import { DurableObject } from 'cloudflare:workers';
import { BUILTIN_SOUNDS } from './builtin-sounds.js';
import { Tg } from './telegram.js';
import { webhookSecret, toHex } from './auth.js';

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
    this.sql.exec('CREATE TABLE IF NOT EXISTS builtin_off (id TEXT PRIMARY KEY)');
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

  /** results: [{uid, name, photo, score, guest}] */
  recordGame(results, winner) {
    const now = Date.now();
    for (const r of results) {
      if (r.guest || !r.uid) continue;
      this.sql.exec(
        `INSERT INTO users (id, name, photo, games, wins, points, best, updated) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, photo = excluded.photo, games = games + 1,
           wins = wins + excluded.wins, points = points + excluded.points, best = MAX(best, excluded.best), updated = excluded.updated`,
        r.uid,
        r.name || '',
        r.photo || '',
        r.uid === winner ? 1 : 0,
        Math.max(0, Math.round(r.score || 0)),
        Math.max(0, Math.round(r.score || 0)),
        now,
      );
    }
    return true;
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

  /** كل الأصوات (النظام + المضافة) مع حالتها — لقائمة الأدمن بالبوت. */
  listAll() {
    const off = this.builtinOff();
    const builtin = BUILTIN_SOUNDS.map((b) => ({ key: b.id, title: b.title, emoji: b.emoji, kind: 'builtin', active: !off.has(b.id) }));
    const custom = this.sql
      .exec('SELECT id, title, kind, img_file_id, active FROM sounds ORDER BY id')
      .toArray()
      .map((c) => ({ key: 'c:' + c.id, title: c.title, emoji: c.kind === 'video' ? '🎬' : c.img_file_id ? '🖼️' : '🎙️', kind: 'custom', active: !!c.active }));
    return [...custom, ...builtin];
  }

  /** تفعيل/تعطيل صوت. يرجع {title, active} أو null. */
  toggleSound(key) {
    if (key.startsWith('b:')) {
      const b = BUILTIN_SOUNDS.find((x) => x.id === key);
      if (!b) return null;
      const off = this.builtinOff().has(key);
      if (off) this.sql.exec('DELETE FROM builtin_off WHERE id = ?', key);
      else this.sql.exec('INSERT OR IGNORE INTO builtin_off (id) VALUES (?)', key);
      return { title: b.title, active: off };
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
    if (key.startsWith('b:')) {
      const b = BUILTIN_SOUNDS.find((x) => x.id === key);
      if (!b) return null;
      this.sql.exec('INSERT OR IGNORE INTO builtin_off (id) VALUES (?)', key);
      return { title: b.title, deleted: false };
    }
    return null;
  }

  setBuiltinAll(active) {
    if (active) this.sql.exec('DELETE FROM builtin_off');
    else for (const b of BUILTIN_SOUNDS) this.sql.exec('INSERT OR IGNORE INTO builtin_off (id) VALUES (?)', b.id);
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
    const builtin = BUILTIN_SOUNDS.filter((b) => !off.has(b.id)).map((b) => ({ ...b, img: '', video: false, w: 1 }));
    if (mode !== 'custom' || custom.length < n) pool = [...pool, ...builtin];
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

  /* ---------------- ربط البوت بتيليجرام */
  async ensureWebhook(origin, force = false) {
    const token = (this.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token) return { ok: false, reason: 'TELEGRAM_BOT_TOKEN غير مضبوط' };
    const digest = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))).slice(0, 12);
    const stamp = `${origin}|${digest}|v4`;
    if (!force && this.getKV('webhook') === stamp) return { ok: true, cached: true, bot: this.getKV('bot') };
    const tg = new Tg(token, this.env.TG_API_BASE);
    try {
      const me = await tg.call('getMe');
      this.setKV('bot', me.username);
      await tg.call('setWebhook', {
        url: origin + '/api/telegram/webhook',
        secret_token: await webhookSecret(token),
        allowed_updates: ['message', 'callback_query'],
      });
      await tg.call('setMyCommands', {
        commands: [
          { command: 'start', description: 'ابدأ' },
          { command: 'play', description: 'سوّي غرفة لعب' },
          { command: 'top', description: 'المتصدرين' },
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
    return {
      webhook: this.getKV('webhook_at') || 'لم يُسجَّل بعد',
      webhookError: this.getKV('webhook_error') || null,
      bot: this.getKV('bot'),
      sounds: this.sql.exec('SELECT COUNT(*) AS c FROM sounds WHERE active = 1').one().c,
      builtinOn: BUILTIN_SOUNDS.length - this.builtinOff().size,
      players: this.sql.exec('SELECT COUNT(*) AS c FROM users').one().c,
    };
  }
}
