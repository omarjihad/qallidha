// عجلة الحظ (SVG) مع دوران محسوب يوكف على القطعة اللي يحددها السيرفر.

import { WHEEL } from './shared.js';

const NS = 'http://www.w3.org/2000/svg';
const SEG = 360 / WHEEL.length;

function svg(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
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
    const root = svg('svg', { viewBox: '-120 -126 240 246', class: 'wheel-svg' });
    const defs = svg('defs', {}, root);
    const hub = svg('radialGradient', { id: 'hubg', cx: '40%', cy: '35%', r: '70%' }, defs);
    svg('stop', { offset: '0%', 'stop-color': '#fff6b0' }, hub);
    svg('stop', { offset: '55%', 'stop-color': '#ffc51a' }, hub);
    svg('stop', { offset: '100%', 'stop-color': '#d98200' }, hub);
    const sh = svg('filter', { id: 'wsh', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
    svg('feDropShadow', { dx: '0', dy: '4', stdDeviation: '4', 'flood-color': '#2a0008', 'flood-opacity': '0.55' }, sh);

    // الإطار الأحمر
    svg('circle', { r: 108, fill: '#b5121b', filter: 'url(#wsh)' }, root);
    svg('circle', { r: 101, fill: '#7d0a12' }, root);

    const rot = svg('g', { class: 'wheel-rot' }, root);
    this.rot = rot;
    WHEEL.forEach((s, i) => {
      const a0 = i * SEG - SEG / 2;
      const a1 = i * SEG + SEG / 2;
      const [x0, y0] = polar(97, a0);
      const [x1, y1] = polar(97, a1);
      svg('path', { d: `M0 0 L${x0} ${y0} A97 97 0 0 1 ${x1} ${y1} Z`, fill: s.color, stroke: 'rgba(0,0,0,0.18)', 'stroke-width': 1 }, rot);
      const g = svg('g', { transform: `rotate(${i * SEG})` }, rot);
      // فقاعة الأيقونة
      svg('circle', { cx: 0, cy: -73, r: 15.5, fill: 'rgba(255,255,255,0.93)', stroke: 'rgba(0,0,0,0.25)', 'stroke-width': 1.5 }, g);
      const ic = svg('text', { x: 0, y: -67.5, 'text-anchor': 'middle', 'font-size': 15.5, class: 'wheel-icon' }, g);
      ic.textContent = s.icon;
      const arabic = /[\u0600-\u06FF]/.test(s.label);
      const lb = svg('text', { x: 0, y: -45, 'text-anchor': 'middle', 'font-size': s.label.length > 4 ? 9 : 11, class: 'wheel-label', direction: arabic ? 'rtl' : 'ltr' }, g);
      lb.textContent = s.label;
    });
    // اللمبات
    for (let i = 0; i < 20; i++) {
      const [x, y] = polar(104.5, i * 18 + 9);
      svg('circle', { cx: x, cy: y, r: 3.6, class: 'bulb' + (i % 2 ? ' b2' : '') }, root);
    }
    svg('circle', { r: 20, fill: 'url(#hubg)', stroke: '#8a4b00', 'stroke-width': 2 }, root);
    const star = svg('text', { x: 0, y: 7, 'text-anchor': 'middle', 'font-size': 20 }, root);
    star.textContent = '⭐';
    // المؤشر
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
