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
  // ---- شخصيات المتجر والباس
  { skin: '#f0c09a', hair: '#17171a', style: 'ninja', band: '#d62f3a', shirt: '#22222a', pants: '#22222a', shoes: '#111111', brows: 'angry', card: '#6c7a89' },
  { skin: '#8fc27a', hair: '#3d4a2a', style: 'messy', shirt: '#5d6b7a', pants: '#4a3f35', shoes: '#2a2a2a', brows: 'flat', lids: true, card: '#7fcf6a' },
  { skin: '#c3ccd6', hair: '#c3ccd6', style: 'antenna', shirt: '#3a7bd5', pants: '#5b6573', shoes: '#2c3e50', brows: 'flat', card: '#a8c7ff' },
  { skin: '#e0ac80', hair: '#2b1a10', style: 'long', shirt: '#b0262f', pants: '#2d2d2d', shoes: '#3b2412', brows: 'angry', belt: true, card: '#ff8a80' },
  { skin: '#f3c7a0', hair: '#6b4226', style: 'short', shirt: '#ffffff', pants: '#2d2d2d', shoes: '#111111', brows: 'up', card: '#ffd8a8' },
  { skin: '#f1c27d', hair: '#e63946', style: 'mohawk', shirt: '#1a1a1a', pants: '#3a3a8a', shoes: '#111111', brows: 'angry', card: '#ff4d6d' },
  { skin: '#e8b48c', hair: '#5a3418', style: 'short', shirt: '#6a1b9a', pants: '#4a148c', shoes: '#d4af37', brows: 'up', belt: true, crown: true, card: '#e9c46a' },
  { skin: '#f3c7a0', hair: '#5a3418', style: 'helmet', shirt: '#f2f2f2', pants: '#f2f2f2', shoes: '#b8b8b8', brows: 'soft', card: '#9ad0ff' },
];

/* ============================================================ مسارح (ثيمات) */
// wall: تدرّج الجدار، fx: زخرفة، floor: نوع الأرضية وألوانها، light: ألوان الإضاءة
export const THEMES = {
  'stage:classic': { wall: ['#3c1e1f', '#472426'], floor: { kind: 'wood', rgb: [176, 94, 8] }, sky: 0xfff1e6, ground: 0x7a3a18, key: 0xfff4ea, rim: 0xffc6d8, bg: '#3b1d20' },
  'stage:night': { wall: ['#0b1030', '#1c2456'], fx: 'stars', floor: { kind: 'wood', rgb: [72, 66, 128] }, sky: 0xc3ceff, ground: 0x2a2050, key: 0xdfe6ff, rim: 0x9fb4ff, bg: '#0b1030' },
  'stage:studio': { wall: ['#26364a', '#33475f'], fx: 'panels', floor: { kind: 'wood', rgb: [78, 82, 92] }, sky: 0xf1f5ff, ground: 0x2f3a48, key: 0xffffff, rim: 0x9fd2ff, bg: '#26364a' },
  'stage:beach': { wall: ['#5ec8ff', '#d9f4ff'], fx: 'sea', floor: { kind: 'sand', rgb: [226, 192, 132] }, sky: 0xffffff, ground: 0xd8b071, key: 0xfff6e0, rim: 0xffffff, bg: '#5ec8ff' },
  'stage:neon': { wall: ['#07040f', '#120a24'], fx: 'neon', floor: { kind: 'wood', rgb: [40, 32, 60] }, sky: 0xff9cf2, ground: 0x1a0f30, key: 0xf0e6ff, rim: 0x2be8ff, bg: '#07040f' },
  'stage:candy': { wall: ['#ff8fc6', '#ffc6e2'], fx: 'dots', floor: { kind: 'checker', rgb: [255, 182, 214] }, sky: 0xffffff, ground: 0xff9ccf, key: 0xfff0f8, rim: 0xffffff, bg: '#ff8fc6' },
  'stage:gold': { wall: ['#4a0710', '#7a1220'], fx: 'curtain', floor: { kind: 'wood', rgb: [214, 160, 44] }, sky: 0xfff0d0, ground: 0x6a3a08, key: 0xfff0c8, rim: 0xffd27a, bg: '#4a0710' },
  'stage:jungle': { wall: ['#174d2e', '#2e7d4f'], fx: 'leaves', floor: { kind: 'grass', rgb: [96, 146, 62] }, sky: 0xf4ffe6, ground: 0x3a5a1a, key: 0xfff8e0, rim: 0xcfffb0, bg: '#174d2e' },
};

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

const matCacheDS = new Map();
/** مادة بوجهين (للأشكال المفتوحة مثل التاج واللثام) */
function matDS(color, rough = 0.6) {
  const key = color + '|' + rough;
  let m = matCacheDS.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: 0, side: THREE.DoubleSide });
    matCacheDS.set(key, m);
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

function accKey(acc) {
  return acc ? `${acc.head || ''}|${acc.face || ''}` : '';
}

class Character {
  constructor(skinIdx, acc = null) {
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
    this.accKey = '';
    this.build(skinIdx, acc);
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

  build(skinIdx, acc = null) {
    const S = SKINS[((skinIdx % SKINS.length) + SKINS.length) % SKINS.length];
    this.skin = skinIdx;
    this.acc = acc || null;
    this.accKey = accKey(acc);
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
    // الملك: تاجه جزء منه (إلا إذا لابس شي ثاني على راسه)
    this.accessories(head, S.crown && !(acc && acc.head) ? { ...(acc || {}), head: 'head:crown' } : acc);
  }

  /** إكسسوارات الراس والوجه (من المتجر/الباس) */
  accessories(head, acc) {
    this.spinner = null;
    if (!acc) return;
    const add = (geo, color, pos, rot = [0, 0, 0], scale = [1, 1, 1], rough = 0.5, parent = head) =>
      this.part(parent, geo, geo.parameters && geo.parameters.openEnded ? matDS(color, rough) : color, pos, scale, 0, rot, rough);
    const glow = (geo, color, pos, rot = [0, 0, 0], scale = [1, 1, 1]) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }));
      m.position.set(...pos);
      m.rotation.set(...rot);
      m.scale.set(...scale);
      head.add(m);
      return m;
    };
    const cone = (r, h, seg = 20) => new THREE.CylinderGeometry(0, r, h, seg);
    const cyl = (r1, r2, h, seg = 28, open = false) => new THREE.CylinderGeometry(r1, r2, h, seg, 1, open);
    switch (acc.head) {
      case 'head:party':
        add(cone(0.2, 0.5), '#ff4fa3', [0.05, 0.66, 0], [0, 0, -0.18]);
        add(G.sphereLo, '#ffd60a', [0.14, 0.92, 0], [0, 0, 0], [0.07, 0.07, 0.07]);
        add(new THREE.TorusGeometry(0.17, 0.025, 8, 20), '#3a86ff', [0.02, 0.48, 0], [Math.PI / 2, 0.18, 0]);
        break;
      case 'head:cap':
        add(new THREE.SphereGeometry(0.47, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), '#e63946', [0, 0.06, 0], [-0.08, 0, 0]);
        add(cyl(0.3, 0.3, 0.03), '#c1121f', [0, 0.14, -0.34], [-0.25, 0, 0], [1, 1, 0.85]);
        break;
      case 'head:chef':
        add(cyl(0.3, 0.32, 0.32), '#ffffff', [0, 0.52, -0.02], [-0.1, 0, 0], [1, 1, 1], 0.8);
        add(G.sphere, '#ffffff', [0, 0.76, -0.04], [0, 0, 0], [0.4, 0.22, 0.38], 0.8);
        break;
      case 'head:headphones':
        add(new THREE.TorusGeometry(0.47, 0.04, 10, 28, Math.PI), '#26262b', [0, 0.02, 0], [0, 0, 0]);
        for (const sx of [-1, 1]) {
          add(cyl(0.14, 0.14, 0.11), '#26262b', [0.46 * sx, -0.02, 0], [0, 0, Math.PI / 2]);
          add(cyl(0.1, 0.1, 0.12), '#ff4f8b', [0.47 * sx, -0.02, 0], [0, 0, Math.PI / 2]);
        }
        break;
      case 'head:bunny':
        for (const sx of [-1, 1]) {
          add(G.capsule(0.08, 0.36), '#ffffff', [0.17 * sx, 0.68, -0.02], [0.1, 0, -0.15 * sx], [1, 1, 0.6], 0.8);
          add(G.capsule(0.045, 0.3), '#ffb3cd', [0.17 * sx, 0.68, 0.025], [0.1, 0, -0.15 * sx], [1, 1, 0.4], 0.8);
        }
        break;
      case 'head:cowboy':
        add(cyl(0.66, 0.66, 0.035, 32), '#8b5a2b', [0, 0.3, 0], [-0.08, 0, 0]);
        add(cyl(0.29, 0.33, 0.32, 24), '#8b5a2b', [0, 0.47, -0.01], [-0.08, 0, 0]);
        add(cyl(0.335, 0.335, 0.06, 24), '#3b2412', [0, 0.36, -0.01], [-0.08, 0, 0]);
        break;
      case 'head:straw':
        add(cyl(0.66, 0.66, 0.03, 32), '#f4d06f', [0, 0.3, 0], [-0.06, 0, 0], [1, 1, 1], 0.9);
        add(new THREE.SphereGeometry(0.36, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), '#f4d06f', [0, 0.3, 0], [-0.06, 0, 0], [1, 0.75, 1], 0.9);
        add(cyl(0.365, 0.365, 0.07, 24, true), '#d62828', [0, 0.35, 0], [-0.06, 0, 0]);
        break;
      case 'head:tophat':
        add(cyl(0.5, 0.5, 0.04, 30), '#1b1b1e', [0, 0.38, 0], [-0.08, 0, 0], [1, 1, 1], 0.35);
        add(cyl(0.3, 0.3, 0.56, 26), '#1b1b1e', [0, 0.66, -0.02], [-0.08, 0, 0], [1, 1, 1], 0.35);
        add(cyl(0.305, 0.305, 0.08, 26, true), '#d62f3a', [0, 0.45, -0.01], [-0.08, 0, 0]);
        break;
      case 'head:horns':
        for (const sx of [-1, 1]) add(cone(0.08, 0.32, 14), '#d62828', [0.22 * sx, 0.46, 0.05], [0.2, 0, -0.45 * sx], [1, 1, 1], 0.35);
        break;
      case 'head:crown':
      case 'head:goldcrown': {
        const big = acc.head === 'head:goldcrown';
        const r = big ? 0.34 : 0.3;
        add(cyl(r, r + 0.02, big ? 0.2 : 0.16, 26, true), '#f2c230', [0, 0.47, 0], [-0.06, 0, 0], [1, 1, 1], 0.25);
        const n = big ? 7 : 5;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          add(cone(0.06, big ? 0.2 : 0.15, 10), '#f2c230', [Math.sin(a) * r, big ? 0.65 : 0.6, Math.cos(a) * r], [0, 0, 0], [1, 1, 1], 0.25);
          add(G.sphereLo, i % 2 ? '#e63946' : '#3a86ff', [Math.sin(a) * (r + 0.01), 0.47, Math.cos(a) * (r + 0.01)], [0, 0, 0], [0.04, 0.04, 0.04], 0.2);
        }
        if (big) glow(new THREE.TorusGeometry(r + 0.02, 0.012, 6, 30), '#fff3a0', [0, 0.38, 0], [Math.PI / 2, 0, 0]);
        break;
      }
      case 'head:halo':
        glow(new THREE.TorusGeometry(0.3, 0.035, 10, 30), '#ffe066', [0, 0.78, 0], [Math.PI / 2 - 0.15, 0, 0]);
        break;
      case 'head:flower': {
        const cols = ['#ff7eb6', '#ffffff', '#ffd60a'];
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          add(G.sphereLo, cols[i % 3], [Math.sin(a) * 0.4, 0.3, Math.cos(a) * 0.4], [0, 0, 0], [0.075, 0.06, 0.075], 0.7);
        }
        break;
      }
      case 'head:viking':
        add(new THREE.SphereGeometry(0.47, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), '#8d99ae', [0, 0.04, 0], [-0.05, 0, 0], [1, 1, 1], 0.3);
        add(cyl(0.47, 0.47, 0.07, 26, true), '#6c584c', [0, 0.06, 0], [-0.05, 0, 0]);
        for (const sx of [-1, 1]) add(cone(0.08, 0.38, 14), '#f1e3c8', [0.44 * sx, 0.3, 0], [0, 0, -1.0 * sx], [1, 1, 1], 0.6);
        break;
      case 'head:wizard':
        add(cyl(0.58, 0.58, 0.03, 30), '#5a189a', [0, 0.33, 0], [-0.05, 0, 0]);
        add(cone(0.36, 0.85, 24), '#5a189a', [0.06, 0.74, -0.04], [-0.1, 0, -0.16]);
        glow(G.sphereLo, '#ffe066', [0.05, 0.62, 0.3], [0, 0, 0], [0.05, 0.05, 0.02]);
        break;
      case 'head:propeller': {
        add(new THREE.SphereGeometry(0.46, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), '#ffd60a', [0, 0.06, 0], [-0.06, 0, 0]);
        add(new THREE.SphereGeometry(0.465, 24, 12, 0, Math.PI, 0, Math.PI * 0.5), '#3a86ff', [0, 0.06, 0], [-0.06, 0, 0]);
        add(cyl(0.02, 0.02, 0.16, 8), '#333333', [0, 0.58, -0.02]);
        const sp = new THREE.Group();
        sp.position.set(0, 0.67, -0.02);
        head.add(sp);
        add(new THREE.BoxGeometry(0.5, 0.015, 0.08), '#e63946', [0, 0, 0], [0, 0, 0], [1, 1, 1], 0.4, sp);
        add(new THREE.BoxGeometry(0.08, 0.015, 0.5), '#2ec4b6', [0, 0, 0], [0, 0, 0], [1, 1, 1], 0.4, sp);
        this.spinner = sp;
        break;
      }
      default:
    }
    switch (acc.face) {
      case 'face:sunglasses':
        for (const sx of [-1, 1]) add(cyl(0.11, 0.11, 0.025, 22), '#0d0d10', [0.15 * sx, 0.035, 0.405], [Math.PI / 2, 0, 0], [1, 1, 0.85], 0.15);
        add(new THREE.BoxGeometry(0.1, 0.022, 0.02), '#0d0d10', [0, 0.05, 0.42]);
        break;
      case 'face:nerd':
        for (const sx of [-1, 1]) add(new THREE.TorusGeometry(0.09, 0.022, 8, 22), '#3b2a1a', [0.148 * sx, 0.035, 0.41], [0, 0, 0], [1, 1, 1], 0.4);
        add(new THREE.BoxGeometry(0.08, 0.02, 0.02), '#3b2a1a', [0, 0.045, 0.415]);
        break;
      case 'face:clown':
        add(G.sphere, '#e5383b', [0, -0.05, 0.43], [0, 0, 0], [0.075, 0.075, 0.075], 0.25);
        break;
      case 'face:mustache':
        for (const sx of [-1, 1]) add(G.sphere, '#3b2412', [0.075 * sx, -0.125, 0.395], [0, 0, 0.35 * sx], [0.085, 0.032, 0.035], 0.8);
        break;
      case 'face:eyepatch':
        add(cyl(0.1, 0.1, 0.02, 20), '#111111', [0.148, 0.035, 0.405], [Math.PI / 2, 0, 0]);
        add(new THREE.TorusGeometry(0.43, 0.012, 6, 30), '#111111', [0, 0.06, 0], [0.15, 0, -0.35]);
        break;
      case 'face:star':
        for (const sx of [-1, 1]) {
          add(cyl(0.12, 0.12, 0.025, 5), '#ffd60a', [0.15 * sx, 0.035, 0.405], [Math.PI / 2, 0, 0], [1, 1, 1], 0.3);
          add(cyl(0.08, 0.08, 0.03, 5), '#ff4f8b', [0.15 * sx, 0.035, 0.41], [Math.PI / 2, 0, 0], [1, 1, 1], 0.3);
        }
        break;
      case 'face:mask':
        add(new THREE.CylinderGeometry(0.435, 0.415, 0.22, 26, 1, true, -Math.PI * 0.62, Math.PI * 1.24), '#1f1f24', [0, -0.13, 0.02], [0, 0, 0], [1, 1, 1], 0.7);
        break;
      case 'face:monocle':
        add(new THREE.TorusGeometry(0.1, 0.016, 8, 22), '#d4af37', [0.148, 0.035, 0.41], [0, 0, 0], [1, 1, 1], 0.2);
        add(cyl(0.006, 0.006, 0.3, 6), '#d4af37', [0.24, -0.1, 0.4], [0, 0, 0.3]);
        break;
      default:
    }
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
      case 'ninja':
        add(capGeo(0.455, 0.56), [0, 0.03, -0.01], [-0.2, 0, 0]);
        add(new THREE.TorusGeometry(0.44, 0.045, 10, 30), [0, 0.2, 0], [Math.PI / 2 - 0.25, 0, 0], [1, 1, 1], S.band);
        add(G.capsule(0.04, 0.22), [0.12, 0.12, -0.46], [0.6, 0, 0.5], [1, 1, 1], S.band);
        add(G.capsule(0.04, 0.2), [-0.06, 0.1, -0.46], [0.7, 0, -0.4], [1, 1, 1], S.band);
        break;
      case 'messy':
        add(capGeo(0.45), [0, 0.03, -0.015], [-0.3, 0, 0]);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          add(new THREE.CylinderGeometry(0, 0.07, 0.2, 8), [Math.sin(a) * 0.22, 0.42, Math.cos(a) * 0.22 - 0.05], [Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5]);
        }
        break;
      case 'antenna':
        add(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), [0, 0.55, 0], [0, 0, 0], [1, 1, 1], '#7d8590');
        add(G.sphereLo, [0, 0.72, 0], [0, 0, 0], [0.06, 0.06, 0.06], '#e63946');
        for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16), [0.43 * sx, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1], '#7d8590');
        break;
      case 'long':
        add(capGeo(0.45), [0, 0.03, -0.01], [-0.28, 0, 0]);
        add(G.capsule(0.2, 0.42), [0, -0.25, -0.24], [0.15, 0, 0], [1.25, 1, 0.7]);
        add(G.sphere, [0, -0.3, 0.35], [0.3, 0, 0], [0.16, 0.12, 0.08]);
        break;
      case 'mohawk':
        for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.1, 0.22 - Math.abs(i - 2.5) * 0.03, 0.12), [0, 0.47 - Math.abs(i - 2.5) * 0.02, 0.3 - i * 0.13], [-0.25 + i * 0.12, 0, 0]);
        break;
      case 'helmet': {
        add(capGeo(0.445), [0, 0.03, -0.015], [-0.3, 0, 0]);
        const glass = new THREE.Mesh(G.sphere, new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, depthWrite: false }));
        glass.scale.setScalar(0.62);
        glass.position.set(0, 0.02, 0.02);
        head.add(glass);
        add(new THREE.TorusGeometry(0.5, 0.06, 10, 30), [0, -0.38, 0], [Math.PI / 2, 0, 0], [1, 1, 1], '#d9d9d9');
        break;
      }
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
    if (this.spinner) this.spinner.rotation.y += dt * (6 + tk * 20);
  }
}

/* ============================================================ المسرح */

function rng(seed) {
  let x = seed;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
}

/** أرضية: خشب ألواحه طالعة للعمق، رمل، مربعات، أو عشب */
function floorTexture(floor) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  const rnd = rng(23);
  const [R, Gc, B] = floor.rgb;
  const col = (k, d = 0) => `rgb(${Math.max(0, R + d * k) | 0},${Math.max(0, Gc + d * k) | 0},${Math.max(0, B + d * k) | 0})`;
  if (floor.kind === 'sand' || floor.kind === 'grass') {
    g.fillStyle = col(0);
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) {
      const v = (rnd() - 0.5) * (floor.kind === 'grass' ? 40 : 26);
      g.fillStyle = col(1, v);
      const x = rnd() * 512;
      const y = rnd() * 512;
      if (floor.kind === 'grass') g.fillRect(x, y, 2, 6 + rnd() * 6);
      else g.fillRect(x, y, 2 + rnd() * 3, 2 + rnd() * 3);
    }
  } else if (floor.kind === 'checker') {
    const n = 8;
    const w = 512 / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        g.fillStyle = (i + j) % 2 ? '#ffffff' : col(0);
        g.fillRect(i * w, j * w, w, w);
      }
  } else {
    const cols = 8;
    const w = c.width / cols;
    for (let k = 0; k < cols; k++) {
      const v = (rnd() - 0.5) * 16;
      g.fillStyle = col(1, v);
      g.fillRect(k * w, 0, w, c.height);
      // عروق خفيفة
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      g.lineWidth = 1;
      for (let j = 0; j < 4; j++) {
        const x = k * w + 6 + rnd() * (w - 12);
        g.beginPath();
        g.moveTo(x, 0);
        for (let y = 0; y <= c.height; y += 32) g.lineTo(x + Math.sin(y * 0.03 + j) * 1.5, y);
        g.stroke();
      }
      // فواصل بين الألواح + وصلة عرضية
      g.fillStyle = 'rgba(0,0,0,0.42)';
      g.fillRect(k * w, 0, 2, c.height);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(k * w, (rnd() * c.height) | 0, w, 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** جدار: تدرّج + زخرفة حسب المسرح */
function wallTexture(theme) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, theme.wall[0]);
  grd.addColorStop(1, theme.wall[1]);
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 256);
  const rnd = rng(7);
  switch (theme.fx) {
    case 'stars':
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(255,255,255,${0.35 + rnd() * 0.65})`;
        const r = rnd() < 0.08 ? 1.8 : 0.9;
        g.beginPath();
        g.arc(rnd() * 1024, rnd() * 200, r, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#fff6d6';
      g.beginPath();
      g.arc(760, 70, 26, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = theme.wall[0];
      g.beginPath();
      g.arc(772, 62, 24, 0, Math.PI * 2);
      g.fill();
      break;
    case 'panels':
      g.strokeStyle = 'rgba(160,200,255,0.16)';
      g.lineWidth = 3;
      for (let x = 0; x <= 1024; x += 64) g.strokeRect(x + 4, 20, 56, 200);
      g.fillStyle = 'rgba(120,200,255,0.18)';
      g.fillRect(0, 226, 1024, 6);
      break;
    case 'sea': {
      g.fillStyle = '#fff3b0';
      g.beginPath();
      g.arc(220, 70, 34, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 6; i++) {
        const x = rnd() * 1024;
        const y = 30 + rnd() * 80;
        for (let k = 0; k < 4; k++) {
          g.beginPath();
          g.arc(x + k * 16, y + (k % 2) * -6, 14, 0, Math.PI * 2);
          g.fill();
        }
      }
      const sea = g.createLinearGradient(0, 170, 0, 256);
      sea.addColorStop(0, '#1fa3d6');
      sea.addColorStop(1, '#0d6f9e');
      g.fillStyle = sea;
      g.fillRect(0, 170, 1024, 86);
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 2;
      for (let y = 182; y < 256; y += 16) {
        g.beginPath();
        for (let x = 0; x <= 1024; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 2);
        g.stroke();
      }
      break;
    }
    case 'neon': {
      const lines = [
        [60, '#ff2bd6'],
        [120, '#2be8ff'],
        [180, '#ff2bd6'],
      ];
      for (const [y, colr] of lines) {
        g.shadowColor = colr;
        g.shadowBlur = 18;
        g.strokeStyle = colr;
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(1024, y);
        g.stroke();
      }
      g.shadowBlur = 0;
      break;
    }
    case 'dots':
      g.fillStyle = 'rgba(255,255,255,0.55)';
      for (let y = 18; y < 256; y += 36)
        for (let x = (y / 36) % 2 ? 18 : 0; x < 1024; x += 36) {
          g.beginPath();
          g.arc(x, y, 7, 0, Math.PI * 2);
          g.fill();
        }
      break;
    case 'curtain':
      for (let x = 0; x < 1024; x += 32) {
        const cg = g.createLinearGradient(x, 0, x + 32, 0);
        cg.addColorStop(0, 'rgba(0,0,0,0.28)');
        cg.addColorStop(0.5, 'rgba(255,120,120,0.08)');
        cg.addColorStop(1, 'rgba(0,0,0,0.28)');
        g.fillStyle = cg;
        g.fillRect(x, 0, 32, 256);
      }
      g.fillStyle = '#d4af37';
      g.fillRect(0, 0, 1024, 10);
      break;
    case 'leaves':
      for (let i = 0; i < 70; i++) {
        g.fillStyle = `rgba(${10 + rnd() * 30 | 0},${70 + rnd() * 60 | 0},${30 + rnd() * 30 | 0},0.7)`;
        g.beginPath();
        g.ellipse(rnd() * 1024, rnd() * 256, 18 + rnd() * 26, 8 + rnd() * 10, rnd() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
      break;
    default: {
      const rad = g.createRadialGradient(512, 200, 10, 512, 200, 400);
      rad.addColorStop(0, 'rgba(110,56,52,0.16)');
      rad.addColorStop(1, 'rgba(110,56,52,0)');
      g.fillStyle = rad;
      g.fillRect(0, 0, 1024, 256);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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
    const hemi = new THREE.HemisphereLight(0xfff1e6, 0x7a3a18, 1.35);
    s.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4ea, 2.4);
    key.position.set(3, 7, 9);
    s.add(key);
    const rim = new THREE.DirectionalLight(0xffc6d8, 0.7);
    rim.position.set(-6, 5, -4);
    s.add(rim);
    this.lights = { hemi, key, rim };

    this.floorMat = new THREE.MeshLambertMaterial();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(64, 32), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, WALL_Z + 16);
    s.add(floor);

    this.wallMat = new THREE.MeshBasicMaterial();
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(70, 16), this.wallMat);
    wall.position.set(0, 8, WALL_Z);
    s.add(wall);
    this.theme = null;
    this.setTheme('stage:classic');
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

  /** يبدّل المسرح (جدار + أرضية + إضاءة) */
  setTheme(id) {
    const key = THEMES[id] ? id : 'stage:classic';
    if (this.theme === key) return;
    this.theme = key;
    const T = THEMES[key];
    const old = [this.floorMat.map, this.wallMat.map];
    const tex = floorTexture(T.floor);
    tex.repeat.set(T.floor.kind === 'checker' ? 16 : 8, T.floor.kind === 'checker' ? 8 : 4);
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.floorMat.map = tex;
    this.floorMat.needsUpdate = true;
    this.wallMat.map = wallTexture(T);
    this.wallMat.needsUpdate = true;
    for (const t of old) if (t) t.dispose();
    this.lights.hemi.color.set(T.sky);
    this.lights.hemi.groundColor.set(T.ground);
    this.lights.key.color.set(T.key);
    this.lights.rim.color.set(T.rim);
    this.scene.background = new THREE.Color(T.bg);
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
        c = new Character(p.skin, p.acc || null);
        this.chars.set(p.uid, c);
        this.scene.add(c.root);
      } else if (c.skin !== p.skin || c.accKey !== accKey(p.acc)) c.build(p.skin, p.acc || null);
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

export function portrait(skinIdx, acc = null) {
  const pkey = skinIdx + '|' + accKey(acc);
  if (portraitCache.has(pkey)) return portraitCache.get(pkey);
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
  // قبعة (أو تاج الملك)؟ نبعّد الكاميرا شوية حتى تبين كلها
  const S = SKINS[((skinIdx % SKINS.length) + SKINS.length) % SKINS.length];
  if ((acc && acc.head) || S.crown) {
    cam.position.set(0, 2.14, 2.95);
    cam.lookAt(0, 2.1, 0);
  } else {
    cam.position.set(0, 1.78, 2.35);
    cam.lookAt(0, 1.7, 0);
  }
  const c = new Character(skinIdx, acc);
  c.blinkAt = Infinity;
  c.update(0.016, 0);
  c.root.rotation.y = 0.22;
  scene.add(c.root);
  renderer.render(scene, cam);
  const url = canvas.toDataURL('image/png');
  scene.remove(c.root);
  portraitCache.set(pkey, url);
  return url;
}
