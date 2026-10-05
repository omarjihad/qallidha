// عجلة الحظ (SVG) مع دوران محسوب يوكف على القطعة اللي يحددها السيرفر.

import { WHEEL } from './shared.js';
import { t } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const SEG = 360 / WHEEL.length;

function svg(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/** نجمة خماسية */
function starPath(cx, cy, R, r) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r : R;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    d += (i ? 'L' : 'M') + (cx + rad * Math.cos(a)).toFixed(2) + ' ' + (cy + rad * Math.sin(a)).toFixed(2) + ' ';
  }
  return d + 'Z';
}

function polar(r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

export class Wheel {
  constructor(container) {
    this.el = container;
    this.angle = 0;
    this.spinning = false;
    this.build();
  }

  build() {
    this.el.innerHTML = '';
    const root = svg('svg', { viewBox: '-120 -128 240 248', class: 'wheel-svg' });
    const defs = svg('defs', {}, root);
    const hub = svg('radialGradient', { id: 'hubg', cx: '40%', cy: '35%', r: '70%' }, defs);
    svg('stop', { offset: '0%', 'stop-color': '#fff6b0' }, hub);
    svg('stop', { offset: '55%', 'stop-color': '#ffc51a' }, hub);
    svg('stop', { offset: '100%', 'stop-color': '#d98200' }, hub);
    const glow = svg('radialGradient', { id: 'wglow', cx: '50%', cy: '50%', r: '50%' }, defs);
    svg('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.55' }, glow);
    svg('stop', { offset: '45%', 'stop-color': '#ffffff', 'stop-opacity': '0.18' }, glow);
    svg('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': '0' }, glow);
    const coin = svg('radialGradient', { id: 'wcoin', cx: '38%', cy: '32%', r: '75%' }, defs);
    svg('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.95' }, coin);
    svg('stop', { offset: '60%', 'stop-color': '#dfe3ee', 'stop-opacity': '0.75' }, coin);
    svg('stop', { offset: '100%', 'stop-color': '#9aa1b5', 'stop-opacity': '0.7' }, coin);
    const sh = svg('filter', { id: 'wsh', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
    svg('feDropShadow', { dx: '0', dy: '4', stdDeviation: '4', 'flood-color': '#2a0008', 'flood-opacity': '0.55' }, sh);

    // الإطار الأحمر
    svg('circle', { r: 109, fill: '#d0161f', filter: 'url(#wsh)' }, root);
    svg('circle', { r: 109, fill: 'none', stroke: '#8f0b13', 'stroke-width': 2 }, root);
    svg('circle', { r: 99.5, fill: '#8f0b13' }, root);

    const rot = svg('g', { class: 'wheel-rot' }, root);
    this.rot = rot;
    WHEEL.forEach((s, i) => {
      const a0 = i * SEG - SEG / 2;
      const a1 = i * SEG + SEG / 2;
      const [x0, y0] = polar(97, a0);
      const [x1, y1] = polar(97, a1);
      svg('path', { d: `M0 0 L${x0} ${y0} A97 97 0 0 1 ${x1} ${y1} Z`, fill: s.color }, rot);
    });
    svg('circle', { r: 97, fill: 'url(#wglow)' }, rot);
    WHEEL.forEach((s, i) => {
      const g = svg('g', { transform: `rotate(${i * SEG})` }, rot);
      // «عملة» الأيقونة: فضية شفافة ونجمة ذهبية للنقاط (مثل الأصلية)
      svg('circle', { cx: 0, cy: -71, r: 16.5, fill: 'url(#wcoin)', stroke: 'rgba(255,255,255,0.9)', 'stroke-width': 1.6 }, g);
      svg('circle', { cx: 0, cy: -71, r: 12.5, fill: 'none', stroke: 'rgba(80,86,110,0.35)', 'stroke-width': 1.2 }, g);
      if (s.kind === 'sab' || s.kind === 'swap') {
        const ic = svg('text', { x: 0, y: -65.6, 'text-anchor': 'middle', 'font-size': 15, class: 'wheel-icon' }, g);
        ic.textContent = s.icon;
      } else {
        svg('path', { d: starPath(0, -71, 11, 5), fill: '#ffc21a', stroke: '#c96f00', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, g);
        svg('path', { d: starPath(-1.2, -72.6, 5, 2.2), fill: '#fff2a8', opacity: 0.8 }, g);
      }
      const label = t(s.label);
      const arabic = /[\u0600-\u06FF]/.test(label);
      const lb = svg('text', { x: 0, y: -42.5, 'text-anchor': 'middle', 'font-size': label.length > 6 ? 8 : label.length > 4 ? 9.5 : 11.5, class: 'wheel-label', direction: arabic ? 'rtl' : 'ltr' }, g);
      lb.textContent = label;
    });
    // اللمبات
    for (let i = 0; i < 16; i++) {
      const [x, y] = polar(104.5, i * 22.5 + 11.25);
      svg('circle', { cx: x, cy: y, r: 4.4, class: 'bulb' + (i % 2 ? ' b2' : '') }, root);
    }
    // المحور: دائرة ذهبية ونجمة حمراء
    svg('circle', { r: 21, fill: 'url(#hubg)', stroke: '#a35c00', 'stroke-width': 2.2 }, root);
    svg('path', { d: starPath(0, 1, 13.5, 6), fill: '#ff5a1f', stroke: '#b42a00', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, root);
    // المؤشر (دبوس أصفر)
    const pin = svg('g', { transform: 'translate(0,-112)', filter: 'url(#wsh)' }, root);
    svg('path', { d: 'M0 22 C-10 8 -13 2 -13 -4 A13 13 0 1 1 13 -4 C13 2 10 8 0 22 Z', fill: '#ffd60a', stroke: '#a35c00', 'stroke-width': 2 }, pin);
    svg('circle', { cx: 0, cy: -4, r: 5, fill: '#e83a3a' }, pin);
    this.el.appendChild(root);
    this.setAngle(0);
  }

  setAngle(a) {
    this.angle = a;
    this.rot.setAttribute('transform', `rotate(${a})`);
  }

  /** يدور حتى تكون القطعة index تحت المؤشر. onTick لكل حد قطعة. */
  spinTo(index, duration = 4200, onTick, onDone) {
    const start = this.angle % 360;
    const jitter = (Math.random() - 0.5) * SEG * 0.55;
    const target = 360 * 6 + (360 - index * SEG) + jitter;
    const from = start;
    const t0 = performance.now();
    this.spinning = true;
    let lastSeg = Math.floor((from + SEG / 2) / SEG);
    const ease = (x) => 1 - Math.pow(1 - x, 4);
    const frame = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const a = from + (target - from) * ease(p);
      this.setAngle(a);
      const seg = Math.floor((a + SEG / 2) / SEG);
      if (seg !== lastSeg) {
        lastSeg = seg;
        if (onTick) onTick();
      }
      if (p < 1) requestAnimationFrame(frame);
      else {
        this.spinning = false;
        if (onDone) onDone();
      }
    };
    requestAnimationFrame(frame);
  }

  showAt(index) {
    this.setAngle(360 - index * SEG);
  }
}
