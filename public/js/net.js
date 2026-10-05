// الاتصال بالسيرفر: طلبات API + اتصال الغرفة (WebSocket) مع مزامنة الساعة وإعادة الاتصال.

import { initData, insideTelegram, unsafeUser } from './tg.js';
import { t, LANG } from './i18n.js';

const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* وضع خاص */
    }
  },
};

let guest = null;
export function guestIdentity() {
  if (guest) return guest;
  let id = store.get('qd_gid');
  if (!id || id.length < 8) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
    store.set('qd_gid', id);
  }
  let name = store.get('qd_gname');
  if (!name) {
    name = t('ضيف') + ' ' + id.slice(0, 3).toUpperCase();
    store.set('qd_gname', name);
  }
  guest = { id, name };
  return guest;
}

export function authBody() {
  // lang: لغة اللعبة، حتى البوت يحچي ويا اللاعب بنفسها
  if (insideTelegram) return { initData: initData(), lang: LANG };
  const g = guestIdentity();
  return { guestId: g.id, guestName: g.name, lang: LANG };
}

export async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || 'خطأ بالاتصال');
  return data;
}

export function localName() {
  if (insideTelegram) {
    const u = unsafeUser();
    return (u && u.first_name) || t('لاعب');
  }
  return guestIdentity().name;
}

/**
 * اتصال غرفة. الأحداث: state, hello, take, react, error, status
 */
export class RoomConnection {
  constructor(code, handlers) {
    this.code = code;
    this.h = handlers;
    this.offset = 0; // serverNow - Date.now()
    this.bestRtt = Infinity;
    this.closedByUs = false;
    this.retry = 0;
    this.ws = null;
    this.ping = null;
    this.open();
  }

  url() {
    const base = location.origin.replace(/^http/, 'ws') + `/ws/${this.code}`;
    if (insideTelegram) return `${base}?a=${encodeURIComponent(initData())}`;
    const g = guestIdentity();
    return `${base}?g=${encodeURIComponent(g.id)}&n=${encodeURIComponent(g.name)}`;
  }

  open() {
    this.h.status && this.h.status(this.retry ? 'reconnecting' : 'connecting');
    let ws;
    try {
      ws = new WebSocket(this.url());
    } catch (e) {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.retry = 0;
      this.h.status && this.h.status('open');
      this.bestRtt = Infinity;
      for (let i = 0; i < 4; i++) setTimeout(() => this.send({ t: 'sync', c: Date.now() }), i * 220);
      clearInterval(this.ping);
      this.ping = setInterval(() => {
        if (ws.readyState === 1) ws.send('ping');
      }, 20000);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') {
        const u8 = new Uint8Array(e.data);
        if (u8[0] === 2) this.h.take && this.h.take({ round: u8[1], seat: u8[2], data: u8.subarray(4) });
        return;
      }
      if (e.data === 'pong') return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'sync') {
        const now = Date.now();
        const rtt = now - m.c;
        if (rtt < this.bestRtt) {
          this.bestRtt = rtt;
          this.offset = m.s - (m.c + now) / 2;
        }
        return;
      }
      if (m.t === 'hello' && this.bestRtt === Infinity) this.offset = m.s - Date.now();
      if (m.t === 'state' && this.bestRtt === Infinity && m.now) this.offset = m.now - Date.now();
      const fn = this.h[m.t];
      if (fn) fn(m);
    };
    ws.onclose = (e) => {
      clearInterval(this.ping);
      if (this.closedByUs) return;
      if (e.code === 4000) return; // اتصال أحدث فتح من نفس الحساب
      if (e.code === 4001 || e.code === 4002) {
        this.closedByUs = true;
        return;
      }
      this.scheduleRetry();
    };
    ws.onerror = () => {};
  }

  scheduleRetry() {
    if (this.closedByUs) return;
    this.retry++;
    this.h.status && this.h.status('reconnecting');
    if (this.retry > 12) {
      this.h.status && this.h.status('lost');
      return;
    }
    setTimeout(() => this.open(), Math.min(8000, 600 * 2 ** Math.min(4, this.retry - 1)));
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  sendBinary(u8) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(u8);
  }

  close() {
    this.closedByUs = true;
    clearInterval(this.ping);
    try {
      this.send({ t: 'leave' });
      this.ws && this.ws.close(1000, 'bye');
    } catch {
      /* */
    }
  }
}
