// المسرح ثلاثي الأبعاد بشكل اللعبة الأصلية: لقطة واسعة لمسرح خشب ألواحه طالعة للعمق،
// جدار عنابي، مايك بالنص، شخصيات صغيرة بشكل دمى بلاستيك ناعمة، ولقطة قريبة للاعب وقت التسجيل.

import * as THREE from '../vendor/three.min.js';

export const SKINS = [
  { skin: '#f2c29b', hair: '#5a3418', style: 'short', shirt: '#5b6fe0', pants: '#7b6656', shoes: '#2a2a2a', brows: 'angry', lids: true, belt: true, card: '#ffcf4a' },
  { skin: '#f6cfae', hair: '#ff5c9e', style: 'bun', shirt: '#ff4f8b', pants: '#ff4f8b', shoes: '#ff9cc2', brows: 'soft', card: '#ff8fbf' },
  { skin: '#e8b48c', hair: '#e63946', style: 'cap', shirt: '#7fdc3f', pants: '#35507f', shoes: '#ffffff', brows: 'up', card: '#7ee36a' },
  { skin: '#f3c7a0', hair: '#f2b84b', style: 'beanie', beanie: '#3b5bbf', shirt: '#3b5bbf', pants: '#2fae4a', shoes: '#ffffff', brows: 'flat', card: '#6fb7ff' },
  { skin: '#f7d3b5', hair: '#f2b84b', style: 'pony', shirt: '#ffffff', pants: '#5f8fd6', shoes: '#e63946', brows: 'soft', overalls: true, card: '#ffe066' },
  { skin: '#e0ac80', hair: '#4a2a14', style: 'slick', shirt: '#2c3f86', pants: '#2c3f86', shoes: '#1a1a1a', brows: 'angry', tie: '#d62f3a', bag: true, card: '#9fb2ff' },
  { skin: '#9a6440', hair: '#1b1b1b', style: 'afro', shirt: '#ff9f1c', pants: '#3a3a3a', shoes: '#ffffff', brows: 'up', card: '#ffb04a' },
  { skin: '#f1c27d', hair: '#d9d9d9', style: 'short', shirt: '#8e44ad', pants: '#4a4a4a', shoes: '#5a3a22', brows: 'flat', glasses: true, card: '#c79bff' },
];

// أبعاد المسرح محسوبة من لقطات الأصلية: الشخصيات بعيدة عن الجدار شوية، والمايك قدّام بالنص.
export const MIC_POS = new THREE.Vector3(0, 0, 3.5);
const PERFORM_POS = new THREE.Vector3(0, 0, 2.63);
const BACK_Z = 0;
const WALL_Z = -3.2;

const matCache = new Map();
function mat(color, rough = 0.6) {
  const key = color + '|' + rough;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: 0 });
    matCache.set(key, m);
  }
  return m;
}

const G = {
  sphere: new THREE.SphereGeometry(1, 28, 20),
  sphereLo: new THREE.SphereGeometry(1, 16, 12),
  capsule: (r, len) => new THREE.CapsuleGeometry(r, len, 8, 16),
};

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

/* ============================================================ شخصية */

class Character {
  constructor(skinIdx) {
    this.root = new THREE.Group();
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0xff2b2b, side: THREE.BackSide, transparent: true, opacity: 0.95 });
    this.outlines = [];
    this.parts = {};
    this.pos = new THREE.Vector3();
    this.home = new THREE.Vector3();
    this.target = null;
    this.walking = false;
    this.facing = 0;
    this.talk = 0;
    this.talkTarget = 0;
    this.mood = 'idle';
    this.moodUntil = 0;
    this.phase = Math.random() * 10;
    this.blinkAt = performance.now() + 1500 + Math.random() * 3000;
    this.skin = -1;
    this.build(skinIdx);
  }

  part(parent, geo, color, pos, scale = [1, 1, 1], outline = 0, rot = null, rough = 0.6) {
    const m = new THREE.Mesh(geo, typeof color === 'string' ? mat(color, rough) : color);
    m.position.set(...pos);
    m.scale.set(...scale);
    if (rot) m.rotation.set(...rot);
    parent.add(m);
    if (outline) {
      const o = new THREE.Mesh(geo, this.outlineMat);
      o.scale.setScalar(outline);
      o.visible = false;
      m.add(o);
      this.outlines.push(o);
    }
    return m;
  }

  build(skinIdx) {
    const S = SKINS[((skinIdx % SKINS.length) + SKINS.length) % SKINS.length];
    this.skin = skinIdx;
    this.S = S;
    const root = this.root;
    while (root.children.length) root.remove(root.children[0]);
    this.outlines = [];
    const P = (this.parts = {});

    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.5, 28), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.012;
    root.add(sh);

    // الرجلين والحذاء
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.15 * side, 0.64, 0);
      root.add(pivot);
      this.part(pivot, G.capsule(0.125, 0.3), S.pants, [0, -0.27, 0], [1, 1, 1], 1.09);
      this.part(pivot, G.sphere, S.shoes, [0, -0.57, 0.05], [0.155, 0.105, 0.235], 1.1, null, 0.45);
      this.part(pivot, new THREE.BoxGeometry(0.29, 0.03, 0.44), shade(S.shoes, 0.75), [0, -0.655, 0.05], [1, 1, 1], 0);
      P[side < 0 ? 'legL' : 'legR'] = pivot;
    }

    const body = new THREE.Group();
    root.add(body);
    P.body = body;
    this.part(body, G.capsule(0.33, 0.28), S.shirt, [0, 1.0, 0], [1, 1, 0.78], 1.05);
    if (S.belt) this.part(body, new THREE.CylinderGeometry(0.315, 0.315, 0.07, 24), shade(S.pants, 0.6), [0, 0.76, 0], [1, 1, 0.8], 0);
    if (S.overalls) {
      this.part(body, G.capsule(0.335, 0.12), S.pants, [0, 0.86, 0], [1, 1, 0.79], 0);
      this.part(body, new THREE.BoxGeometry(0.32, 0.26, 0.05), S.pants, [0, 1.06, 0.24], [1, 1, 1], 0);
    }
    if (S.tie) {
      this.part(body, new THREE.BoxGeometry(0.08, 0.32, 0.03), S.tie, [0, 1.07, 0.262], [1, 1, 1], 0);
      for (const side of [-1, 1]) this.part(body, new THREE.BoxGeometry(0.12, 0.2, 0.03), '#f4f4f4', [0.07 * side, 1.25, 0.24], [1, 1, 1], 0, [0, 0, 0.5 * side]);
    }
    if (S.style === 'cap') this.part(body, G.sphereLo, shade(S.shirt, 0.85), [0, 1.43, -0.2], [0.27, 0.17, 0.15], 0);
    // الرقبة
    this.part(body, new THREE.CylinderGeometry(0.11, 0.12, 0.14, 16), S.skin, [0, 1.43, 0], [1, 1, 1], 0);

    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.39 * side, 1.29, 0);
      pivot.rotation.z = 0.12 * side;
      body.add(pivot);
      this.part(pivot, G.capsule(0.095, 0.28), S.shirt, [0, -0.2, 0], [1, 1, 1], 1.12);
      const hand = new THREE.Group();
      hand.position.set(0, -0.45, 0.02);
      pivot.add(hand);
      this.part(hand, G.sphere, S.skin, [0, 0, 0], [0.115, 0.125, 0.095], 1.14);
      this.part(hand, G.capsule(0.04, 0.06), S.skin, [-0.08 * side, 0.03, 0.05], [1, 1, 1], 0, [0.3, 0, 0.6 * side]);
      P[side < 0 ? 'armL' : 'armR'] = pivot;
      P[side < 0 ? 'handL' : 'handR'] = hand;
    }
    if (S.bag) {
      const bag = new THREE.Group();
      bag.position.set(0, -0.22, 0.02);
      P.handR.add(bag);
      this.part(bag, new THREE.BoxGeometry(0.34, 0.26, 0.12), '#1c1c1e', [0, -0.05, 0], [1, 1, 1], 0, null, 0.4);
      this.part(bag, new THREE.TorusGeometry(0.07, 0.018, 8, 16, Math.PI), '#1c1c1e', [0, 0.1, 0], [1, 1, 1], 0);
    }

    const head = new THREE.Group();
    head.position.set(0, 1.79, 0);
    body.add(head);
    P.head = head;
    this.part(head, G.sphere, S.skin, [0, 0, 0], [0.43, 0.42, 0.41], 1.04);
    for (const side of [-1, 1]) this.part(head, G.sphereLo, S.skin, [0.42 * side, -0.03, 0], [0.085, 0.11, 0.07], 0);
    P.eyes = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(0.148 * side, 0.035, 0.352);
      head.add(eye);
      this.part(eye, G.sphere, '#ffffff', [0, 0, 0], [0.085, 0.1, 0.05], 0, null, 0.3);
      this.part(eye, G.sphere, '#2a1a10', [0, -0.008, 0.035], [0.05, 0.058, 0.03], 0, null, 0.2);
      const glint = new THREE.Mesh(G.sphereLo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(-0.016 * side, 0.02, 0.064);
      glint.scale.setScalar(0.014);
      eye.add(glint);
      if (S.lids) this.part(eye, G.sphere, shade(S.skin, 0.97), [0, 0.055, 0.008], [0.093, 0.06, 0.056], 0);
      P.eyes.push(eye);
    }
    const browColor = shade(S.hair, 0.55);
    const browRot = { angry: 0.42, soft: -0.15, up: -0.32, flat: 0.05 }[S.brows] || 0;
    P.brows = [];
    for (const side of [-1, 1]) {
      const b = this.part(head, new THREE.BoxGeometry(0.17, 0.048, 0.045), browColor, [0.15 * side, 0.168, 0.375], [1, 1, 1], 0, [0, 0, -browRot * side]);
      P.brows.push(b);
    }
    this.part(head, G.sphere, shade(S.skin, 0.93), [0, -0.055, 0.405], [0.06, 0.055, 0.05], 0);
    P.mouth = this.part(head, G.sphereLo, '#5e1717', [0, -0.195, 0.36], [0.085, 0.02, 0.03], 0, null, 0.5);
    if (S.glasses) {
      for (const side of [-1, 1]) {
        const g = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.017, 8, 22), mat('#141414', 0.3));
        g.position.set(0.148 * side, 0.035, 0.405);
        head.add(g);
      }
      this.part(head, new THREE.BoxGeometry(0.08, 0.016, 0.016), '#141414', [0, 0.045, 0.41], [1, 1, 1], 0);
    }
    this.hair(head, S);
  }

  hair(head, S) {
    const capGeo = (r, thetaFrac = 0.55) => new THREE.SphereGeometry(r, 30, 18, 0, Math.PI * 2, 0, Math.PI * thetaFrac);
    const c = S.hair;
    const add = (geo, pos, rot = [0, 0, 0], scale = [1, 1, 1], col = c) => this.part(head, geo, col, pos, scale, 1.05, rot, 0.75);
    switch (S.style) {
      case 'short':
        add(capGeo(0.445), [0, 0.03, -0.015], [-0.3, 0, 0]);
        add(G.sphere, [0.05, 0.3, 0.2], [0.4, 0, 0.3], [0.24, 0.12, 0.2]);
        add(G.sphere, [-0.16, 0.28, 0.18], [0.3, 0, -0.2], [0.18, 0.1, 0.17]);
        break;
      case 'slick':
        add(capGeo(0.445, 0.52), [0, 0.04, -0.02], [-0.42, 0, 0]);
        add(G.sphere, [0.08, 0.33, 0.12], [0.2, 0, 0.4], [0.26, 0.11, 0.22]);
        break;
      case 'bun':
        add(capGeo(0.45), [0, 0.03, -0.01], [-0.25, 0, 0]);
        add(G.sphere, [0, 0.47, -0.12], [0, 0, 0], [0.18, 0.18, 0.18]);
        add(G.capsule(0.12, 0.3), [0.34, -0.12, -0.1], [0.15, 0, 0.12]);
        add(G.capsule(0.12, 0.3), [-0.34, -0.12, -0.1], [0.15, 0, -0.12]);
        add(G.sphere, [0, 0.26, 0.26], [0.5, 0, 0], [0.3, 0.1, 0.16]);
        break;
      case 'pony':
        add(capGeo(0.45), [0, 0.03, -0.01], [-0.28, 0, 0]);
        add(G.capsule(0.11, 0.36), [0, -0.02, -0.47], [0.55, 0, 0]);
        add(G.sphere, [-0.06, 0.27, 0.27], [0.5, 0, -0.2], [0.27, 0.1, 0.15]);
        add(G.sphere, [0.3, 0.05, 0.22], [0, 0, 0.3], [0.08, 0.2, 0.08]);
        add(G.sphere, [-0.3, 0.05, 0.22], [0, 0, -0.3], [0.08, 0.2, 0.08]);
        break;
      case 'cap': {
        add(capGeo(0.455, 0.5), [0, 0.05, 0], [-0.12, 0, 0], [1, 1, 1], '#ffffff');
        add(capGeo(0.46, 0.33), [0, 0.06, 0], [-0.12, 0, 0], [1, 1, 1], c);
        add(new THREE.CylinderGeometry(0.33, 0.33, 0.035, 28), [0, 0.18, 0.31], [0.22, 0, 0], [1, 1, 0.95], c);
        add(G.sphereLo, [0, 0.48, 0], [0, 0, 0], [0.05, 0.03, 0.05], c);
        add(G.sphere, [0.33, -0.02, 0.12], [0, 0, 0], [0.09, 0.14, 0.12], '#5a3418');
        add(G.sphere, [-0.33, -0.02, 0.12], [0, 0, 0], [0.09, 0.14, 0.12], '#5a3418');
        break;
      }
      case 'beanie':
        add(G.sphere, [0.3, -0.05, 0.16], [0, 0, 0.2], [0.1, 0.2, 0.12]);
        add(G.sphere, [-0.3, -0.05, 0.16], [0, 0, -0.2], [0.1, 0.2, 0.12]);
        add(capGeo(0.465, 0.5), [0, 0.08, 0], [-0.05, 0, 0], [1, 1.06, 1], S.beanie);
        add(new THREE.TorusGeometry(0.43, 0.07, 12, 32), [0, 0.12, 0], [Math.PI / 2 - 0.05, 0, 0], [1, 1, 1], S.beanie);
        break;
      case 'afro':
        add(G.sphere, [0, 0.21, -0.17], [0, 0, 0], [0.52, 0.48, 0.49]);
        break;
      default:
        add(capGeo(0.445), [0, 0.03, -0.015], [-0.3, 0, 0]);
    }
  }

  setHighlight(color) {
    const on = !!color;
    if (on) this.outlineMat.color.set(color);
    for (const o of this.outlines) o.visible = on;
  }

  setHome(x, z) {
    this.home.set(x, 0, z);
    if (!this.placed) {
      this.pos.copy(this.home);
      this.placed = true;
    } else if (!this.atMic && !this.aside && !this.walking) this.walkTo(this.home);
  }

  walkTo(v, onArrive) {
    this.target = v.clone();
    this.walking = true;
    this.onArrive = onArrive || null;
    const d = Math.hypot(v.x - this.pos.x, v.z - this.pos.z);
    this.speed = Math.max(2.6, d / 0.95);
  }

  goToMic() {
    this.atMic = true;
    this.walkTo(PERFORM_POS);
  }

  leaveMic() {
    this.atMic = false;
    this.walkTo(this.home);
  }

  setMood(mood, ms = 1600) {
    this.mood = mood;
    this.moodUntil = performance.now() + ms;
  }

  update(dt, t) {
    const P = this.parts;
    const now = performance.now();
    if (this.mood !== 'idle' && now > this.moodUntil) this.mood = 'idle';
    let walkAmt = 0;
    if (this.walking && this.target) {
      const d = new THREE.Vector3().subVectors(this.target, this.pos);
      d.y = 0;
      const dist = d.length();
      if (dist < 0.03) {
        this.pos.copy(this.target);
        this.walking = false;
        const cb = this.onArrive;
        this.onArrive = null;
        if (cb) cb();
      } else {
        this.pos.addScaledVector(d.normalize(), Math.min(dist, (this.speed || 2.6) * dt));
        walkAmt = 1;
        this.facing = Math.atan2(d.x, d.z);
      }
    }
    const faceTarget = this.walking ? this.facing : -this.pos.x * 0.05;
    let dy = faceTarget - this.root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.root.rotation.y += dy * Math.min(1, dt * 9);

    const ph = t + this.phase;
    let bob = Math.sin(ph * 2.1) * 0.01;
    let jump = 0;
    let armSwing = 0;
    let armUp = 0;
    let headTilt = Math.sin(ph * 0.8) * 0.05;
    let headNod = 0;
    let lean = 0;
    let sway = Math.sin(ph * 1.05) * 0.02;

    if (walkAmt) {
      const w = t * 10;
      P.legL.rotation.x = Math.sin(w) * 0.6;
      P.legR.rotation.x = -Math.sin(w) * 0.6;
      armSwing = Math.sin(w) * 0.55;
      bob = Math.abs(Math.sin(w)) * 0.06;
      sway = 0;
    } else {
      P.legL.rotation.x *= 0.8;
      P.legR.rotation.x *= 0.8;
    }

    this.talk += (this.talkTarget - this.talk) * Math.min(1, dt * 18);
    const tk = this.talk;
    if (tk > 0.02) {
      headNod = Math.sin(t * 9) * 0.08 * tk;
      armUp = 0.55 * tk;
      lean = 0.05 * tk;
    }

    switch (this.mood) {
      case 'happy':
        jump = Math.max(0, Math.sin(t * 9)) * 0.22;
        armUp = 2.3;
        break;
      case 'sad':
        headNod = 0.35;
        lean = -0.04;
        break;
      case 'shock':
        armUp = 1.4;
        headTilt = Math.sin(t * 25) * 0.08;
        break;
      case 'sing':
        armUp = 0.9 + Math.sin(t * 6) * 0.2;
        headNod = Math.sin(t * 7) * 0.1;
        break;
      default:
    }

    this.root.position.set(this.pos.x, bob + jump, this.pos.z);
    P.body.rotation.x = lean;
    P.body.rotation.z = sway;
    P.head.rotation.z = headTilt;
    P.head.rotation.x = -headNod * 0.6 + (this.mood === 'sad' ? 0.3 : 0);
    P.armL.rotation.x = armSwing - armUp * 0.5;
    P.armR.rotation.x = -armSwing - armUp * 0.5;
    P.armL.rotation.z = -0.12 - armUp * 0.55;
    P.armR.rotation.z = 0.12 + armUp * 0.55;
    const open = Math.max(tk, this.mood === 'happy' || this.mood === 'shock' ? 0.7 : this.mood === 'sing' ? 0.45 + Math.abs(Math.sin(t * 8)) * 0.4 : 0);
    P.mouth.scale.y = 0.02 + open * 0.075;
    P.mouth.scale.x = 0.085 - open * 0.015;
    // رمش
    let blink = 1;
    if (now > this.blinkAt) {
      const k = (now - this.blinkAt) / 130;
      if (k >= 1) this.blinkAt = now + 2200 + Math.random() * 3500;
      else blink = Math.abs(1 - 2 * k);
    }
    for (const e of P.eyes) e.scale.y = Math.max(0.1, blink);
    for (const b of P.brows) b.position.y = 0.168 + (this.mood === 'shock' ? 0.04 : 0) + tk * 0.015;
  }
}

/* ============================================================ المسرح */

function woodTexture() {
  // ألواح طالعة للعمق: خطوط عمودية بالنسيج = خطوط تتلاقى بالمنظور مثل الأصلية
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  const cols = 8;
  const w = c.width / cols;
  let seed = 23;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < cols; k++) {
    const base = [176 + (rnd() - 0.5) * 16, 94 + (rnd() - 0.5) * 12, 8 + (rnd() - 0.5) * 6];
    g.fillStyle = `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`;
    g.fillRect(k * w, 0, w, c.height);
    // عروق خفيفة
    g.strokeStyle = 'rgba(120,52,0,0.2)';
    g.lineWidth = 1;
    for (let j = 0; j < 4; j++) {
      const x = k * w + 6 + rnd() * (w - 12);
      g.beginPath();
      g.moveTo(x, 0);
      for (let y = 0; y <= c.height; y += 32) g.lineTo(x + Math.sin(y * 0.03 + j) * 1.5, y);
      g.stroke();
    }
    // فواصل بين الألواح
    g.fillStyle = 'rgba(92,40,0,0.8)';
    g.fillRect(k * w, 0, 2, c.height);
    // وصلة عرضية
    const joint = (rnd() * c.height) | 0;
    g.fillStyle = 'rgba(92,40,0,0.55)';
    g.fillRect(k * w, joint, w, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function wallTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#3c1e1f');
  grd.addColorStop(1, '#472426');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const rad = g.createRadialGradient(128, 200, 10, 128, 200, 170);
  rad.addColorStop(0, 'rgba(110,56,52,0.16)');
  rad.addColorStop(1, 'rgba(110,56,52,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// اللقطات: الكاميرا والهدف والزاوية مطابقة لنِسَب الأصلية (الجدار ~53% من الارتفاع، الأقدام ~64%، المايك ~82%)
const SHOTS = {
  wide: { pos: [0, 6.88, 14.63], look: [0, 1.56, 0], fov: 36 },
  menu: { pos: [0, 4.9, 11.4], look: [0, 1.5, 0], fov: 36 },
  medium: { pos: [0, 4.47, 8.76], look: [0, 1.39, 0], fov: 36 },
};

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#3b1d20');
    this.camera = new THREE.PerspectiveCamera(33, 2, 0.1, 120);
    this.chars = new Map();
    this.order = [];
    this.clock = new THREE.Clock();
    this.listeners = [];
    this.w = 2;
    this.h = 1;
    this.shot = { kind: 'menu', uid: null };
    this.cam = { pos: new THREE.Vector3(...SHOTS.menu.pos), look: new THREE.Vector3(...SHOTS.menu.look), fov: SHOTS.menu.fov };
    this.camera.fov = SHOTS.menu.fov;
    this.camInit = false;
    this.buildScene();
    this.loop = this.loop.bind(this);
    this.running = true;
    requestAnimationFrame(this.loop);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.clock.getDelta();
    });
  }

  buildScene() {
    const s = this.scene;
    s.add(new THREE.AmbientLight(0xffffff, 0.55));
    s.add(new THREE.HemisphereLight(0xfff1e6, 0x7a3a18, 1.35));
    const key = new THREE.DirectionalLight(0xfff4ea, 2.4);
    key.position.set(3, 7, 9);
    s.add(key);
    const rim = new THREE.DirectionalLight(0xffc6d8, 0.7);
    rim.position.set(-6, 5, -4);
    s.add(rim);

    const wood = woodTexture();
    wood.repeat.set(8, 4);
    wood.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(64, 32), new THREE.MeshLambertMaterial({ map: wood }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, WALL_Z + 16);
    s.add(floor);

    const wall = new THREE.Mesh(new THREE.PlaneGeometry(70, 16), new THREE.MeshBasicMaterial({ map: wallTexture() }));
    wall.position.set(0, 8, WALL_Z);
    s.add(wall);
    const base = new THREE.Mesh(new THREE.BoxGeometry(70, 0.16, 0.08), new THREE.MeshBasicMaterial({ color: '#2a1012' }));
    base.position.set(0, 0.08, WALL_Z + 0.04);
    s.add(base);

    // المايك
    const mic = new THREE.Group();
    const dark = mat('#1b1b1d', 0.35);
    const add = (geo, m, pos, rot) => {
      const x = new THREE.Mesh(geo, m);
      x.position.set(...pos);
      if (rot) x.rotation.set(...rot);
      mic.add(x);
      return x;
    };
    add(new THREE.CylinderGeometry(0.24, 0.28, 0.045, 30), dark, [0, 0.022, 0]);
    add(new THREE.CylinderGeometry(0.022, 0.022, 1.55, 12), dark, [0, 0.8, 0]);
    const head = new THREE.Group();
    head.position.set(0, 1.58, 0);
    head.rotation.x = -0.6;
    mic.add(head);
    const h1 = new THREE.Mesh(G.capsule(0.03, 0.14), dark);
    h1.position.set(0, 0.09, 0);
    head.add(h1);
    const grill = new THREE.Mesh(G.sphere, mat('#7d7d84', 0.3));
    grill.scale.setScalar(0.062);
    grill.position.set(0, 0.21, 0);
    head.add(grill);
    mic.position.copy(MIC_POS);
    s.add(mic);
    this.mic = mic;
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** wide | menu | medium | closeup(uid) */
  setShot(kind, uid = null, instant = false) {
    this.shot = { kind, uid };
    if (instant) this.camInit = false;
  }

  shotTarget() {
    const { kind, uid } = this.shot;
    if (kind === 'closeup' && this.chars.get(uid)) {
      // لقطة قريبة بمستوى الوجه: الراس ~37–56% من الارتفاع والأقدام ورا الشريط
      const c = this.chars.get(uid);
      const x = c.home.x;
      const z = c.home.z;
      return { pos: new THREE.Vector3(x, 2.11, z + 7.33), look: new THREE.Vector3(x, 1.68, z), fov: 36 };
    }
    const S = SHOTS[kind] || SHOTS.wide;
    const out = { pos: new THREE.Vector3(...S.pos), look: new THREE.Vector3(...S.look), fov: S.fov };
    // لازم كل الشخصيات تبين: إذا الشاشة ضيقة أو اللاعبين هواية نبعّد الكاميرا على نفس الخط
    let maxX = 0;
    for (const c of this.chars.values()) maxX = Math.max(maxX, Math.abs(c.home.x));
    const need = maxX + (kind === 'medium' ? 1.3 : 1.6);
    const off = out.pos.clone().sub(out.look);
    const half = off.length() * Math.tan((S.fov * Math.PI) / 360) * (this.w / this.h);
    const k = Math.max(1, need / Math.max(0.1, half));
    out.pos.copy(out.look).addScaledVector(off, Math.min(2.2, k));
    return out;
  }

  /** players: [{uid, skin}] بالترتيب */
  setPlayers(players) {
    const seen = new Set();
    players.forEach((p) => {
      seen.add(p.uid);
      let c = this.chars.get(p.uid);
      if (!c) {
        c = new Character(p.skin);
        this.chars.set(p.uid, c);
        this.scene.add(c.root);
      } else if (c.skin !== p.skin) c.build(p.skin);
    });
    for (const [uid, c] of this.chars) {
      if (!seen.has(uid)) {
        this.scene.remove(c.root);
        this.chars.delete(uid);
      }
    }
    this.order = players.map((p) => p.uid);
    const n = this.order.length;
    const spacing = n <= 3 ? 3.0 : 2.7;
    this.order.forEach((uid, i) => {
      let x = (i - (n - 1) / 2) * spacing;
      if (n === 1) x = -1.5;
      this.chars.get(uid).setHome(x, BACK_Z);
    });
  }

  char(uid) {
    return this.chars.get(uid);
  }

  /** اللاعب يمشي للمايك (مثل الأصلية: الباقين يبقون بمكانهم). */
  focus(uid) {
    const perf = this.chars.get(uid);
    if (perf) perf.goToMic();
  }

  unfocus(uid) {
    const perf = this.chars.get(uid);
    if (perf) perf.leaveMic();
  }

  /** موقع نقطة فوق الشخصية على الشاشة + طول الشخصية بالبكسل (لتحجيم الأسماء). */
  screenPos(uid, yOff = 2.45) {
    const c = this.chars.get(uid);
    if (!c) return null;
    const p = c.root.position;
    const v = new THREE.Vector3(p.x, p.y + yOff, p.z).project(this.camera);
    const f = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
    return {
      x: ((v.x + 1) / 2) * this.w,
      y: ((1 - v.y) / 2) * this.h,
      feetY: ((1 - f.y) / 2) * this.h,
      behind: v.z > 1,
    };
  }

  onFrame(fn) {
    this.listeners.push(fn);
  }

  offFrame(fn) {
    this.listeners = this.listeners.filter((f) => f !== fn);
  }

  updateCamera(dt) {
    const T = this.shotTarget();
    const k = this.camInit ? 1 - Math.exp(-dt * 4.5) : 1;
    this.camInit = true;
    this.cam.pos.lerp(T.pos, k);
    this.cam.look.lerp(T.look, k);
    this.cam.fov += (T.fov - this.cam.fov) * k;
    this.camera.position.copy(this.cam.pos);
    this.camera.lookAt(this.cam.look);
    if (Math.abs(this.camera.fov - this.cam.fov) > 0.01) {
      this.camera.fov = this.cam.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    for (const c of this.chars.values()) c.update(dt, t);
    this.updateCamera(dt);
    for (const fn of this.listeners) fn(dt, t);
    this.renderer.render(this.scene, this.camera);
  }
}

/* ============================================================ صور الكروت */

const portraitCache = new Map();
let portraitRig = null;

export function portrait(skinIdx) {
  if (portraitCache.has(skinIdx)) return portraitCache.get(skinIdx);
  if (!portraitRig) {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(180, 180, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    scene.add(new THREE.HemisphereLight(0xfff1e6, 0x7a3a18, 1.3));
    const d = new THREE.DirectionalLight(0xffffff, 2.2);
    d.position.set(1.5, 3, 5);
    scene.add(d);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    cam.position.set(0, 1.78, 2.35);
    cam.lookAt(0, 1.7, 0);
    portraitRig = { renderer, scene, cam, canvas };
  }
  const { renderer, scene, cam, canvas } = portraitRig;
  const c = new Character(skinIdx);
  c.blinkAt = Infinity;
  c.update(0.016, 0);
  c.root.rotation.y = 0.22;
  scene.add(c.root);
  renderer.render(scene, cam);
  const url = canvas.toDataURL('image/png');
  scene.remove(c.root);
  portraitCache.set(skinIdx, url);
  return url;
}
