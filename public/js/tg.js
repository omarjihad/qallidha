// غلاف Telegram.WebApp + وضع العرض (Landscape) بنفس طريقة «رقعة»:
// اللعبة تتدوّر بنفسها 90° داخل الشاشة الطولية — مو الجهاز.

const webApp = (window.Telegram && window.Telegram.WebApp) || null;

function safely(label, fn) {
  try {
    return fn();
  } catch (e) {
    console.warn('[tg] ' + label, e);
    return undefined;
  }
}

export const tg = webApp;
export const insideTelegram = Boolean(webApp && webApp.initData && webApp.initData.length > 0);
export const platform = (webApp && webApp.platform) || 'web';

export function initData() {
  return (webApp && webApp.initData) || '';
}

export function unsafeUser() {
  return (webApp && webApp.initDataUnsafe && webApp.initDataUnsafe.user) || null;
}

export function startParam() {
  const p = webApp && webApp.initDataUnsafe && webApp.initDataUnsafe.start_param;
  if (p) return p;
  const q = new URLSearchParams(location.search);
  if (q.get('room')) return 'r' + q.get('room');
  return q.get('tgWebAppStartParam') || '';
}

export function haptic(kind) {
  const h = webApp && webApp.HapticFeedback;
  if (!h) return;
  safely('haptic', () => {
    if (kind === 'success' || kind === 'error' || kind === 'warning') h.notificationOccurred(kind);
    else if (kind === 'select') h.selectionChanged();
    else h.impactOccurred(kind || 'light');
  });
}

export function openTgLink(url) {
  if (webApp && webApp.openTelegramLink) safely('openTelegramLink', () => webApp.openTelegramLink(url));
  else window.open(url, '_blank');
}

export function shareText(url, text) {
  openTgLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
}

export function closingConfirmation(on) {
  if (!webApp) return;
  safely('closingConfirmation', () => (on ? webApp.enableClosingConfirmation() : webApp.disableClosingConfirmation()));
}

let backHandler = null;
export function backButton(handler) {
  if (!webApp || !webApp.BackButton) return;
  safely('BackButton', () => {
    if (backHandler) webApp.BackButton.offClick(backHandler);
    backHandler = handler;
    if (handler) {
      webApp.BackButton.onClick(handler);
      webApp.BackButton.show();
    } else webApp.BackButton.hide();
  });
}

/* ===================== المقاسات والمساحات الآمنة ===================== */

function syncViewportHeight() {
  let reported = 0;
  safely('viewportStableHeight', () => {
    reported = (webApp && webApp.viewportStableHeight) || 0;
  });
  const winH = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const h = reported > 0 ? Math.min(reported, winH) : winH;
  document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`);
}

function syncSafeAreaInsets() {
  const root = document.documentElement;
  const outer = webApp && webApp.safeAreaInset;
  const inner = webApp && webApp.contentSafeAreaInset;
  const merge = (side) => Math.max(0, (outer && outer[side]) || 0) + Math.max(0, (inner && inner[side]) || 0);
  // عند التدوير: أعلى الجهاز يصير يسار المحتوى، ويمينه أعلاه… وهكذا.
  const map = rotated
    ? { top: 'right', right: 'bottom', bottom: 'left', left: 'top' }
    : { top: 'top', right: 'right', bottom: 'bottom', left: 'left' };
  for (const side of ['top', 'right', 'bottom', 'left']) {
    root.style.setProperty(`--tg-safe-${side}`, `${merge(map[side])}px`);
  }
}

export function isLandscape() {
  const w = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
  const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  return w > h;
}

/* ===================== وضع العرض =====================
 * lockOrientation() بتيليجرام تثبّت الاتجاه الحالي ولا تختار، فما نستدعيها إلا وإحنا بالعرض.
 * screen.orientation.lock('landscape') هو اللي يقدر يفرض العرض (يحتاج ملء شاشة غالبًا).
 * وإذا ما نفع: ندوّر المحتوى نفسه 90 درجة.
 */
let landscapeWanted = false;
let landscapeLocked = false;
let attempts = 0;
let rotated = false;
const listeners = new Set();

function orientationApi() {
  try {
    return (screen && screen.orientation) || null;
  } catch {
    return null;
  }
}

function keepLandscapeLocked() {
  if (!landscapeWanted || landscapeLocked || !isLandscape()) return;
  safely('lockOrientation', () => webApp && webApp.lockOrientation && webApp.lockOrientation());
  landscapeLocked = true;
}

async function lockToLandscape() {
  const o = orientationApi();
  if (!o || !o.lock) return false;
  try {
    await o.lock('landscape');
    keepLandscapeLocked();
    return true;
  } catch {
    return false;
  }
}

function requestDocumentFullscreen() {
  const el = document.documentElement;
  safely('document.requestFullscreen', () => {
    const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen();
    if (r && r.catch) r.catch(() => undefined);
  });
}

function isMobile() {
  if (platform === 'android' || platform === 'ios') return true;
  if (!insideTelegram) return matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('rotate');
  return false;
}

function applyRotation() {
  const root = document.documentElement;
  const w = Math.round((window.visualViewport && window.visualViewport.width) || window.innerWidth);
  const h = Math.round((window.visualViewport && window.visualViewport.height) || window.innerHeight);
  const should = landscapeWanted && h > w && isMobile();
  if (should) {
    rotated = true;
    root.dataset.rotated = '1';
    root.style.setProperty('--rot-width', `${h}px`);
    root.style.setProperty('--rot-height', `${w}px`);
    root.style.setProperty('--rot-origin', `${w / 2}px`);
  } else if (rotated) {
    rotated = false;
    delete root.dataset.rotated;
    root.style.removeProperty('--rot-width');
    root.style.removeProperty('--rot-height');
    root.style.removeProperty('--rot-origin');
  }
  root.dataset.layout = rotated || isLandscape() ? 'landscape' : 'portrait';
  syncSafeAreaInsets();
  for (const fn of listeners) safely('viewport listener', fn);
}

export function isRotated() {
  return rotated;
}

/** أبعاد مساحة اللعب الفعلية (بعد التدوير إن وجد). */
export function stageSize() {
  const w = Math.round((window.visualViewport && window.visualViewport.width) || window.innerWidth);
  const h = Math.round((window.visualViewport && window.visualViewport.height) || window.innerHeight);
  return rotated ? { w: h, h: w } : { w, h };
}

/** تحويل نقطة من فضاء الشاشة إلى فضاء المحتوى المُدار. */
export function toLocalPoint(clientX, clientY) {
  if (!rotated) return { x: clientX, y: clientY };
  const w = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
  return { x: clientY, y: w - clientX };
}

export function onViewportChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function requestLandscape() {
  landscapeWanted = true;
  safely('requestFullscreen', () => webApp && webApp.requestFullscreen && webApp.isVersionAtLeast && webApp.isVersionAtLeast('8.0') && webApp.requestFullscreen());
  requestDocumentFullscreen();
  applyRotation();
  const retry = () =>
    lockToLandscape().then((ok) => {
      syncViewportHeight();
      applyRotation();
      if (ok || attempts >= 4) return;
      attempts++;
      setTimeout(() => {
        if (landscapeWanted && !landscapeLocked) retry();
      }, 260 * attempts);
    });
  retry();
}

function onEnvironmentChanged() {
  syncViewportHeight();
  if (landscapeWanted) {
    if (isLandscape()) keepLandscapeLocked();
    else if (!landscapeLocked) lockToLandscape();
  }
  applyRotation();
}

export function initTelegram() {
  syncViewportHeight();
  window.addEventListener('resize', onEnvironmentChanged);
  window.addEventListener('orientationchange', onEnvironmentChanged);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onEnvironmentChanged);
  document.addEventListener('fullscreenchange', onEnvironmentChanged);

  if (webApp) {
    safely('ready', () => webApp.ready());
    safely('expand', () => webApp.expand());
    safely('disableVerticalSwipes', () => webApp.disableVerticalSwipes && webApp.disableVerticalSwipes());
    safely('colors', () => {
      webApp.setHeaderColor && webApp.setHeaderColor('#2a0f12');
      webApp.setBackgroundColor && webApp.setBackgroundColor('#2a0f12');
      webApp.setBottomBarColor && webApp.setBottomBarColor('#2a0f12');
    });
    for (const ev of ['viewportChanged', 'fullscreenChanged', 'fullscreenFailed', 'safeAreaChanged', 'contentSafeAreaChanged', 'orientationChanged']) {
      safely('onEvent ' + ev, () => webApp.onEvent(ev, onEnvironmentChanged));
    }
  }
  // العرض مطلوب من لحظة فتح اللعبة
  requestLandscape();
  // ملء شاشة DOM يحتاج لمسة: نعيد الطلب عند أول لمسة
  const once = () => {
    requestDocumentFullscreen();
    if (!landscapeLocked) lockToLandscape().then(() => applyRotation());
    window.removeEventListener('pointerdown', once, true);
  };
  window.addEventListener('pointerdown', once, true);
}
