// الإقلاع: تيليجرام + المسرح + القائمة الرئيسية.

import { initTelegram, stageSize, onViewportChange, startParam, insideTelegram, unsafeUser, haptic, isRotated } from './tg.js';
import { Stage } from './stage.js';
import { AudioEngine } from './audio.js';
import { Game } from './game.js';
import { api, authBody, localName } from './net.js';
import * as ui from './ui.js';
import { $, el } from './ui.js';
import { REACTIONS, GAME_NAME, VERSION, MAX_PLAYERS, ROUNDS } from './shared.js';

initTelegram();

const audio = new AudioEngine();
const stage = new Stage($('#stage'));
let config = {};
let profile = null;
let game = null;
let busy = false;

function layout() {
  const { w, h } = stageSize();
  const root = document.documentElement;
  root.style.setProperty('--u', `${(h / 100).toFixed(3)}px`);
  root.style.setProperty('--sw', `${w}px`);
  root.style.setProperty('--sh', `${h}px`);
  stage.resize(w, h);
}
layout();
onViewportChange(layout);
window.addEventListener('resize', () => setTimeout(layout, 50));

// أي لمسة تفتح الصوت (سياسات التشغيل التلقائي)
window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });

// أزرار التفاعل
const reacts = $('#reacts');
for (const e of REACTIONS) reacts.appendChild(el('button', { class: 'react-btn', onclick: () => game && game.sendReaction(e) }, e));

$('#exitBtn').addEventListener('click', () => game && game.askLeave());

/* ------------------------------------------------------------ القائمة */

function demoStage() {
  stage.setPlayers([
    { uid: 'demo1', skin: 2 },
    { uid: 'demo2', skin: 0 },
    { uid: 'demo3', skin: 1 },
  ]);
  let i = 0;
  clearInterval(demoStage.iv);
  demoStage.iv = setInterval(() => {
    if (document.documentElement.dataset.screen !== 'menu') return;
    const ids = ['demo1', 'demo2', 'demo3'];
    const c = stage.char(ids[i % 3]);
    if (c) c.setMood(['sing', 'happy', 'sing', 'shock'][i % 4], 1500);
    i++;
  }, 1700);
}

function showMenu() {
  document.documentElement.dataset.screen = 'menu';
  demoStage();
  const s = (profile && profile.stats) || {};
  const name = (profile && profile.user && profile.user.name) || localName();
  const photo = profile && profile.user && profile.user.photo;
  const chip = el(
    'div',
    { class: 'profile-chip' },
    photo ? el('img', { src: photo, alt: '' }) : el('span', { class: 'pc-ph' }, name.slice(0, 1)),
    el('div', {}, el('b', {}, name), el('small', {}, `⭐ ${s.points || 0} · 🏆 ${s.wins || 0}${s.rank ? ' · #' + s.rank : ''}`)),
  );
  const menu = el(
    'div',
    { class: 'menu' },
    chip,
    el('div', { class: 'menu-brand' }, el('div', { class: 'logo' }, GAME_NAME + '!'), el('div', { class: 'tagline' }, 'قلّد الأصوات… والذكاء يحكم 🎤')),
    el(
      'div',
      { class: 'menu-btns' },
      el('button', { class: 'btn pink big', onclick: () => createRoom(false) }, '🎤 العب ويا ربعك'),
      el('button', { class: 'btn blue', onclick: joinByCode }, '🔢 ادخل بكود'),
      el('button', { class: 'btn green', onclick: () => createRoom(true) }, '🎯 تحدّي فردي'),
      el('button', { class: 'btn purple', onclick: showTop }, '🏆'),
      el('button', { class: 'btn teal', onclick: showHelp }, '❓'),
    ),
    el('div', { class: 'version' }, `v${VERSION}${insideTelegram ? '' : ' · ضيف'}`),
  );
  ui.overlay(menu, 'menu-layer');
}

async function createRoom(solo) {
  if (busy) return;
  busy = true;
  haptic('medium');
  await audio.unlock();
  try {
    const { code } = await api('/api/rooms', authBody());
    enterRoom(code, solo);
  } catch (e) {
    ui.toast(e.message || 'صار خطأ');
  } finally {
    busy = false;
  }
}

function joinByCode() {
  haptic('light');
  ui.overlay(
    ui.keypad(
      (code) => {
        audio.unlock();
        enterRoom(code, false);
      },
      () => showMenu(),
    ),
    'panel-layer',
  );
}

async function showTop() {
  haptic('light');
  ui.overlay(el('div', { class: 'panel board' }, el('div', { class: 'panel-title' }, '🏆 المتصدرين'), el('div', { class: 'hint center' }, 'جاري التحميل…')), 'panel-layer');
  try {
    const { top } = await api('/api/top');
    ui.overlay(ui.leaderboardPanel(top, profile && profile.user && profile.user.uid, () => showMenu()), 'panel-layer');
  } catch (e) {
    ui.toast(e.message);
    showMenu();
  }
}

function showHelp() {
  haptic('light');
  const steps = [
    ['👂', 'اسمع المثال', 'يشتغل صوت للكل بنفس اللحظة'],
    ['🎤', 'قلّده', `الكل يسجّل سوا بعد العد — فرصة وحدة بس`],
    ['💯', 'الدرجة', 'كل تسجيل ينعاد قدام الكل وياخذ درجة من 100 على اللحن والإيقاع'],
    ['🎡', 'العجلة', 'نقاط، مضاعفات، وتخريب على ربعك 😈'],
  ];
  ui.overlay(
    el(
      'div',
      { class: 'panel help' },
      el('button', { class: 'xbtn', onclick: () => showMenu() }, '✕'),
      el('div', { class: 'panel-title' }, 'شلون تلعب؟'),
      el(
        'div',
        { class: 'help-grid' },
        steps.map(([i, t, d]) => el('div', { class: 'help-step' }, el('div', { class: 'help-icon' }, i), el('b', {}, t), el('span', {}, d))),
      ),
      el('div', { class: 'hint center' }, `لحد ${MAX_PLAYERS} لاعبين · ${ROUNDS} جولات · نبرة صوتك ما تفرق — المهم تقلّد اللحن`),
    ),
    'panel-layer',
  );
}

function enterRoom(code, solo) {
  if (game) game.leave(true);
  stage.setPlayers([]);
  game = new Game({
    stage,
    audio,
    config,
    onExit: (silent) => {
      game = null;
      refreshProfile();
      showMenu();
      if (!silent) haptic('light');
    },
  });
  if (solo) {
    const orig = game.apply.bind(game);
    let started = false;
    game.apply = (st) => {
      orig(st);
      if (!started && st.phase === 'lobby' && st.host === game.me) {
        started = true;
        game.start();
      }
    };
  }
  game.enter(code);
}

async function refreshProfile() {
  try {
    profile = await api('/api/me', authBody());
  } catch {
    /* */
  }
}

/* ------------------------------------------------------------ الإقلاع */

async function boot() {
  try {
    [config, profile] = await Promise.all([api('/api/config').catch(() => ({})), api('/api/me', authBody()).catch((e) => ({ error: e.message }))]);
  } catch {
    /* */
  }
  $('#boot').classList.add('hide');
  setTimeout(() => $('#boot').remove(), 600);
  if (profile && profile.error) {
    ui.overlay(
      el('div', { class: 'panel' }, el('div', { class: 'panel-title' }, '😕'), el('div', { class: 'hint center' }, profile.error)),
      'panel-layer',
    );
    return;
  }
  const sp = startParam();
  const m = /^r(\d{5})$/.exec(sp || '');
  if (m) enterRoom(m[1], false);
  else showMenu();
}

boot();

// للتشخيص من DevTools
window.__qd = { stage, audio, get game() { return game; }, isRotated, unsafeUser };
