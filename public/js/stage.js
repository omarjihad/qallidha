// المسرح ثلاثي الأبعاد: أرضية خشب، جدار، مايك بالنص، وشخصيات كرتونية بتظليل toon وحدود سوداء.

import * as THREE from '../vendor/three.min.js';

export const SKINS = [
  { skin: '#f2c29b', hair: '#4a2c17', style: 'short', shirt: '#4f6bd8', pants: '#6b4f3a', shoes: '#262626', brows: 'angry', card: '#ffcf4a' },
  { skin: '#f6cfae', hair: '#ff5c9e', style: 'bun', shirt: '#ff4f8b', pants: '#ff9cc2', shoes: '#ffffff', brows: 'soft', card: '#ff8fbf' },
  { skin: '#e8b48c', hair: '#e63946', style: 'cap', shirt: '#78d64b', pants: '#3a5fa8', shoes: '#ffffff', brows: 'up', card: '#7ee36a' },
  { skin: '#c98a5d', hair: '#2f6fd6', style: 'beanie', shirt: '#3fb36b', pants: '#2d4a85', shoes: '#e9e9e9', brows: 'flat', card: '#6fb7ff' },
  { skin: '#f7d3b5', hair: '#f2c14e', style: 'pony', shirt: '#ffffff', pants: '#4fb3e8', shoes: '#ef476f', brows: 'soft', card: '#ffe066' },
  { skin: '#e0ac80', hair: '#1e1e1e', style: 'slick', shirt: '#2b3a67', pants: '#2b3a67', shoes: '#111111', brows: 'angry', tie: '#e63946', card: '#9fb2ff' },
  { skin: '#8d5a3b', hair: '#1b1b1b', style: 'afro', shirt: '#ff9f1c', pants: '#333333', shoes: '#ffffff', brows: 'up', card: '#ffb04a' },
  { skin: '#f1c27d', hair: '#d9d9d9', style: 'short', shirt: '#8e44ad', pants: '#4a4a4a', shoes: '#5a3a22', brows: 'flat', glasses: true, card: '#c79bff' },
];

const MIC_POS = new THREE.Vector3(0, 0, 1.15);
const PERFORM_POS = new THREE.Vector3(0, 0, 0.45);

let gradientMap = null;
function toonGradient() {
  if (!gradientMap) {
    gradientMap = new THREE.DataTexture(new Uint8Array([95, 170, 255]), 3, 1, THREE.RedFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.generateMipmaps = false;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

const matCache = new Map();
function toon(color) {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: toonGradient() });
    matCache.set(color, m);
  }
  return m;
}
const basic = (color) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });

const G = {
  sphere: new THREE.SphereGeometry(1, 24, 18),
  sphereLo: new THREE.SphereGeometry(1, 14, 10),
  capsule: (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14),
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
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0x1a0808, side: THREE.BackSide });
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
    this.skin = -1;
    this.build(skinIdx);
  }

  part(parent, geo, color, pos, scale = [1, 1, 1], outline = 1.06, rot = null) {
    const m = new THREE.Mesh(geo, typeof color === 'string' ? toon(color) : color);
    m.position.set(...pos);
    m.scale.set(...scale);
    if (rot) m.rotation.set(...rot);
    parent.add(m);
    if (outline) {
      const o = new THREE.Mesh(geo, this.outlineMat);
      o.scale.setScalar(outline);
      m.add(o);
    }
    return m;
  }

  build(skinIdx) {
    const S = SKINS[((skinIdx % SKINS.length) + SKINS.length) % SKINS.length];
    this.skin = skinIdx;
    const root = this.root;
    while (root.children.length) root.remove(root.children[0]);
    const P = (this.parts = {});

    // ظل
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.48, 28), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.012;
    root.add(sh);

    // الرجلين
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.15 * side, 0.64, 0);
      root.add(pivot);
      this.part(pivot, G.capsule(0.12, 0.32), S.pants, [0, -0.27, 0], [1, 1, 1], 1.08);
      this.part(pivot, G.sphere, S.shoes, [0, -0.56, 0.06], [0.15, 0.1, 0.22], 1.12);
      P[side < 0 ? 'legL' : 'legR'] = pivot;
    }

    const body = new THREE.Group();
    root.add(body);
    P.body = body;
    this.part(body, G.capsule(0.32, 0.3), S.shirt, [0, 1.0, 0], [1, 1, 0.82], 1.05);
    if (S.tie) this.part(body, new THREE.BoxGeometry(0.08, 0.3, 0.03), S.tie, [0, 1.08, 0.27], [1, 1, 1], 0);
    if (S.style === 'cap' || S.style === 'beanie') {
      // هودي: قبّعة خلفية صغيرة
      this.part(body, G.sphereLo, shade(S.shirt, 0.85), [0, 1.42, -0.2], [0.26, 0.16, 0.14], 1.08);
    }

    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.38 * side, 1.31, 0);
      pivot.rotation.z = 0.14 * side;
      body.add(pivot);
      this.part(pivot, G.capsule(0.088, 0.3), S.shirt, [0, -0.22, 0], [1, 1, 1], 1.12);
      this.part(pivot, G.sphere, S.skin, [0, -0.46, 0.01], [0.1, 0.1, 0.1], 1.14);
      P[side < 0 ? 'armL' : 'armR'] = pivot;
    }

    const head = new THREE.Group();
    head.position.set(0, 1.74, 0);
    body.add(head);
    P.head = head;
    this.part(head, G.sphere, S.skin, [0, 0, 0], [0.42, 0.405, 0.395], 1.05);
    for (const side of [-1, 1]) this.part(head, G.sphereLo, S.skin, [0.41 * side, -0.03, 0], [0.085, 0.1, 0.07], 1.15);
    for (const side of [-1, 1]) {
      this.part(head, G.sphereLo, '#151010', [0.145 * side, 0.03, 0.372], [0.045, 0.062, 0.03], 0);
      const hl = new THREE.Mesh(G.sphereLo, basic('#ffffff'));
      hl.position.set(0.135 * side, 0.058, 0.396);
      hl.scale.setScalar(0.014);
      head.add(hl);
    }
    const browColor = shade(S.hair, 0.6);
    const browRot = { angry: 0.38, soft: -0.12, up: -0.3, flat: 0 }[S.brows] || 0;
    P.brows = [];
    for (const side of [-1, 1]) {
      const b = this.part(head, new THREE.BoxGeometry(0.14, 0.032, 0.03), browColor, [0.15 * side, 0.145, 0.378], [1, 1, 1], 0, [0, 0, -browRot * side]);
      b.userData.base = -browRot * side;
      P.brows.push(b);
    }
    this.part(head, G.sphereLo, shade(S.skin, 0.88), [0, -0.05, 0.41], [0.05, 0.045, 0.04], 0);
    P.mouth = this.part(head, G.sphereLo, '#5a1414', [0, -0.18, 0.358], [0.075, 0.018, 0.03], 0);
    if (S.glasses) {
      for (const side of [-1, 1]) {
        const g = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 20), toon('#111111'));
        g.position.set(0.145 * side, 0.035, 0.392);
        head.add(g);
      }
      this.part(head, new THREE.BoxGeometry(0.07, 0.015, 0.015), '#111111', [0, 0.04, 0.4], [1, 1, 1], 0);
    }
    this.hair(head, S);

    // نقطة الاصطدام (للاختيار باللمس)
    this.root.userData.character = this;
  }

  hair(head, S) {
    const capGeo = (r, thetaFrac = 0.55) => new THREE.SphereGeometry(r, 26, 16, 0, Math.PI * 2, 0, Math.PI * thetaFrac);
    const c = S.hair;
    const add = (geo, pos, rot = [0, 0, 0], scale = [1, 1, 1], ol = 1.04) => this.part(head, geo, c, pos, scale, ol, rot);
    switch (S.style) {
      case 'short':
        add(capGeo(0.43), [0, 0.02, -0.01], [-0.32, 0, 0]);
        add(G.capsule(0.07, 0.3), [0.03, 0.28, 0.27], [0.5, 0, Math.PI / 2 + 0.25], [1, 1, 1], 1.1);
        break;
      case 'slick':
        add(capGeo(0.43, 0.5), [0, 0.03, -0.02], [-0.45, 0, 0]);
        break;
      case 'bun':
        add(capGeo(0.435), [0, 0.02, -0.01], [-0.28, 0, 0]);
        add(G.sphere, [0, 0.43, -0.14], [0, 0, 0], [0.17, 0.17, 0.17], 1.08);
        add(G.capsule(0.11, 0.25), [0.33, -0.12, -0.08], [0.15, 0, 0.1], [1, 1, 1], 1.08);
        add(G.capsule(0.11, 0.25), [-0.33, -0.12, -0.08], [0.15, 0, -0.1], [1, 1, 1], 1.08);
        break;
      case 'pony':
        add(capGeo(0.435), [0, 0.02, -0.01], [-0.3, 0, 0]);
        add(G.capsule(0.1, 0.34), [0, -0.02, -0.46], [0.55, 0, 0], [1, 1, 1], 1.08);
        add(G.capsule(0.06, 0.3), [-0.05, 0.27, 0.27], [0.5, 0, Math.PI / 2 - 0.2], [1, 1, 1], 1.1);
        break;
      case 'cap': {
        add(capGeo(0.445, 0.5), [0, 0.04, 0], [-0.12, 0, 0]);
        const brim = new THREE.CylinderGeometry(0.32, 0.32, 0.035, 26);
        add(brim, [0, 0.17, 0.3], [0.22, 0, 0], [1, 1, 0.95], 1.06);
        add(G.sphereLo, [0, 0.45, 0], [0, 0, 0], [0.05, 0.03, 0.05], 0);
        break;
      }
      case 'beanie':
        add(capGeo(0.455, 0.52), [0, 0.06, 0], [-0.05, 0, 0]);
        add(new THREE.TorusGeometry(0.42, 0.065, 10, 28), [0, 0.12, 0], [Math.PI / 2 - 0.05, 0, 0], [1, 1, 1], 1.05);
        add(G.sphereLo, [0, 0.52, -0.02], [0, 0, 0], [0.09, 0.09, 0.09], 1.1);
        break;
      case 'afro':
        add(G.sphere, [0, 0.2, -0.17], [0, 0, 0], [0.5, 0.47, 0.48], 1.04);
        break;
      default:
        add(capGeo(0.43), [0, 0.02, -0.01], [-0.32, 0, 0]);
    }
  }

  setHighlight(color) {
    this.outlineMat.color.set(color || 0x1a0808);
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
    if (this.mood !== 'idle' && performance.now() > this.moodUntil) this.mood = 'idle';
    // مشي
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
        const step = Math.min(dist, 3.0 * dt);
        this.pos.addScaledVector(d.normalize(), step);
        walkAmt = 1;
        this.facing = Math.atan2(d.x, d.z);
      }
    }
    const faceTarget = this.walking ? this.facing : -this.pos.x * 0.07;
    let dy = faceTarget - this.root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.root.rotation.y += dy * Math.min(1, dt * 10);

    const ph = t * 1.0 + this.phase;
    let bob = Math.sin(ph * 2.2) * 0.012;
    let jump = 0;
    let armSwing = 0;
    let armUp = 0;
    let headTilt = Math.sin(ph * 0.9) * 0.05;
    let headNod = 0;
    let lean = 0;

    if (walkAmt) {
      const w = t * 11;
      P.legL.rotation.x = Math.sin(w) * 0.55;
      P.legR.rotation.x = -Math.sin(w) * 0.55;
      armSwing = Math.sin(w) * 0.5;
      bob = Math.abs(Math.sin(w)) * 0.06;
    } else {
      P.legL.rotation.x *= 0.8;
      P.legR.rotation.x *= 0.8;
    }

    // الكلام/الغناء: الفم يتبع مستوى الصوت
    this.talk += (this.talkTarget - this.talk) * Math.min(1, dt * 18);
    const tk = this.talk;
    if (tk > 0.02) {
      headNod = Math.sin(t * 9) * 0.08 * tk;
      armUp = 0.6 * tk;
      lean = 0.06 * tk;
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
    P.head.rotation.z = headTilt;
    P.head.rotation.x = -headNod * 0.6 + (this.mood === 'sad' ? 0.3 : 0);
    P.armL.rotation.x = armSwing - armUp * 0.5;
    P.armR.rotation.x = -armSwing - armUp * 0.5;
    P.armL.rotation.z = -0.14 - armUp * 0.55;
    P.armR.rotation.z = 0.14 + armUp * 0.55;
    const open = Math.max(tk, this.mood === 'happy' || this.mood === 'shock' ? 0.7 : this.mood === 'sing' ? 0.45 + Math.abs(Math.sin(t * 8)) * 0.4 : 0);
    P.mouth.scale.y = 0.018 + open * 0.07;
    P.mouth.scale.x = 0.075 - open * 0.015;
    for (const b of P.brows) b.position.y = 0.145 + (this.mood === 'shock' ? 0.04 : 0) + tk * 0.015;
  }
}

/* ============================================================ المسرح */

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  const rows = 8;
  const h = c.height / rows;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rows; r++) {
    const base = [214 + (rnd() - 0.5) * 22, 124 + (rnd() - 0.5) * 18, 38 + (rnd() - 0.5) * 12];
    const grd = g.createLinearGradient(0, r * h, 0, (r + 1) * h);
    grd.addColorStop(0, `rgb(${base[0] + 10},${base[1] + 8},${base[2] + 4})`);
    grd.addColorStop(1, `rgb(${base[0] - 14},${base[1] - 12},${base[2] - 6})`);
    g.fillStyle = grd;
    g.fillRect(0, r * h, c.width, h);
    g.strokeStyle = 'rgba(120,55,10,0.25)';
    g.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      const y = r * h + 6 + rnd() * (h - 12);
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= c.width; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + k) * 2);
      g.stroke();
    }
    const off = rnd() * c.width;
    g.fillStyle = 'rgba(95,40,8,0.55)';
    g.fillRect((off + 0) % c.width, r * h, 3, h);
    g.fillRect((off + c.width / 2) % c.width, r * h, 3, h);
    g.fillStyle = 'rgba(90,38,8,0.85)';
    g.fillRect(0, r * h, c.width, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function wallTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#2c0d10');
  grd.addColorStop(0.55, '#4a1b1e');
  grd.addColorStop(1, '#5a2427');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,200,220,0.55)');
  grd.addColorStop(1, 'rgba(255,160,200,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2a0d10');
    this.camera = new THREE.PerspectiveCamera(30, 2, 0.1, 100);
    this.chars = new Map(); // uid → Character
    this.order = [];
    this.clock = new THREE.Clock();
    this.listeners = [];
    this.w = 2;
    this.h = 1;
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
    s.add(new THREE.AmbientLight(0xffffff, 0.45));
    s.add(new THREE.HemisphereLight(0xffe9d6, 0x5a2a12, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(2.5, 6, 8);
    s.add(dir);

    const wood = woodTexture();
    wood.repeat.set(4, 3);
    wood.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 18), new THREE.MeshLambertMaterial({ map: wood }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 6.2);
    s.add(floor);

    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshBasicMaterial({ map: wallTexture() }));
    wall.position.set(0, 6, -2.8);
    s.add(wall);
    const base = new THREE.Mesh(new THREE.BoxGeometry(40, 0.22, 0.12), new THREE.MeshBasicMaterial({ color: '#240a0c' }));
    base.position.set(0, 0.11, -2.74);
    s.add(base);

    const glow = glowTexture();
    const spots = [
      [-3.6, 4.3, '#ff9ccf', 3.2],
      [-0.6, 4.6, '#ffffff', 2.3],
      [2.2, 4.4, '#ffb3d9', 3.0],
      [4.6, 4.1, '#ffe2f0', 2.2],
    ];
    for (const [x, y, col, sc] of spots) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: col, transparent: true, opacity: 0.55, depthWrite: false }));
      sp.position.set(x, y, -2.6);
      sp.scale.set(sc, sc * 0.7, 1);
      s.add(sp);
    }

    // المايك
    const mic = new THREE.Group();
    const dark = toon('#1d1d1f');
    const add = (geo, mat, pos, rot) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...pos);
      if (rot) m.rotation.set(...rot);
      mic.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(0.26, 0.3, 0.05, 28), dark, [0, 0.025, 0]);
    add(new THREE.CylinderGeometry(0.024, 0.024, 1.36, 12), dark, [0, 0.7, 0]);
    const head = new THREE.Group();
    head.position.set(0, 1.42, 0);
    head.rotation.x = -0.55;
    mic.add(head);
    const h1 = new THREE.Mesh(G.capsule(0.032, 0.15), dark);
    h1.position.set(0, 0.09, 0);
    head.add(h1);
    const grill = new THREE.Mesh(G.sphere, toon('#8e8e94'));
    grill.scale.setScalar(0.068);
    grill.position.set(0, 0.22, 0);
    head.add(grill);
    mic.position.copy(MIC_POS);
    s.add(mic);
    this.mic = mic;
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // نضمن عرض كافي للخمس شخصيات حتى بالشاشات الأقل عرضًا
    const halfW = 4.8;
    const vfov = 31;
    const hfov = 2 * Math.atan(Math.tan((vfov * Math.PI) / 360) * aspect);
    const dist = Math.max(9.6, halfW / Math.tan(hfov / 2));
    this.camera.fov = vfov;
    this.camera.position.set(0, 2.05, dist);
    this.camera.lookAt(0, 1.32, 0);
    this.camera.updateProjectionMatrix();
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
      } else if (c.skin !== p.skin) {
        c.build(p.skin);
      }
    });
    for (const [uid, c] of this.chars) {
      if (!seen.has(uid)) {
        this.scene.remove(c.root);
        this.chars.delete(uid);
      }
    }
    this.order = players.map((p) => p.uid);
    const n = this.order.length;
    const spacing = n >= 5 ? 1.75 : 1.9;
    this.order.forEach((uid, i) => {
      const x = (i - (n - 1) / 2) * spacing;
      const z = -0.55 - 0.1 * Math.abs(x);
      this.chars.get(uid).setHome(n === 1 ? -1.7 : x, n === 1 ? -0.4 : z);
    });
  }

  char(uid) {
    return this.chars.get(uid);
  }

  /** اللاعب يمشي للمايك، واللي واكف بالنص يتنحّى شوية حتى ما يتغطّى. */
  focus(uid) {
    const perf = this.chars.get(uid);
    if (!perf) return;
    perf.goToMic();
    for (const [id, c] of this.chars) {
      if (id === uid || c.atMic) continue;
      if (Math.abs(c.home.x) < 0.9) {
        c.aside = true;
        const dir = perf.home.x <= 0 ? 1 : -1;
        c.walkTo(new THREE.Vector3(c.home.x + dir * 1.05, 0, c.home.z - 0.35));
      }
    }
  }

  unfocus(uid) {
    const perf = this.chars.get(uid);
    if (perf) perf.leaveMic();
    for (const c of this.chars.values()) {
      if (c.aside) {
        c.aside = false;
        c.walkTo(c.home);
      }
    }
  }

  /** موقع رأس الشخصية على الشاشة (بكسل محلي) */
  screenPos(uid, yOff = 2.42) {
    const c = this.chars.get(uid);
    if (!c) return null;
    const v = new THREE.Vector3(c.root.position.x, c.root.position.y + yOff, c.root.position.z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h, behind: v.z > 1 };
  }

  onFrame(fn) {
    this.listeners.push(fn);
  }

  offFrame(fn) {
    this.listeners = this.listeners.filter((f) => f !== fn);
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    for (const c of this.chars.values()) c.update(dt, t);
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
    renderer.setSize(160, 160, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    scene.add(new THREE.HemisphereLight(0xffe9d6, 0x5a2a12, 0.8));
    const d = new THREE.DirectionalLight(0xffffff, 1.5);
    d.position.set(1.5, 3, 5);
    scene.add(d);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    cam.position.set(0, 1.62, 3.0);
    cam.lookAt(0, 1.55, 0);
    portraitRig = { renderer, scene, cam, canvas };
  }
  const { renderer, scene, cam, canvas } = portraitRig;
  const c = new Character(skinIdx);
  c.update(0.016, 0);
  c.root.rotation.y = 0.18;
  scene.add(c.root);
  renderer.render(scene, cam);
  const url = canvas.toDataURL('image/png');
  scene.remove(c.root);
  portraitCache.set(skinIdx, url);
  return url;
}
