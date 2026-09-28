/* ============================================================
   Мини-ГТА — игровая логика
   Городская аркада с видом сверху. Без библиотек, всё на canvas 2D.

   Устройство файла:
     1. Настройки и утилиты
     2. Мир: генерация кварталов, дорог, домов
     3. Сущности: игрок, машины, копы, пешеходы, пули, деньги
     4. Ввод: клавиатура, мышь, сенсорный джойстик
     5. Логика: движение, стрельба, розыск, урон
     6. Отрисовка: мир, сущности, эффекты, миникарта
     7. Интерфейс: HUD, экраны, сохранение
     8. Игровой цикл
   ============================================================ */

(() => {
'use strict';

/* ============================================================
   1. НАСТРОЙКИ И УТИЛИТЫ
   ============================================================ */

const TILE = 80;                 // размер клетки города в пикселях мира
const COLS = 40;                 // кварталов по горизонтали
const ROWS = 40;                 // и по вертикали
const BLOCK = 4;                 // клеток в квартале
const ROAD = 1;                  // клеток занимает дорога
const CELL = BLOCK + ROAD;       // период: квартал + дорога

const WORLD_W = COLS * CELL * TILE;
const WORLD_H = ROWS * CELL * TILE;

const STEP = 1 / 60;             // фиксированный шаг физики

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const angleDiff = (a, b) => {
  let d = (b - a + Math.PI) % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return d - Math.PI;
};

/** Красивое число для счётчика денег: 12 500. */
const money = (n) => Math.max(0, Math.floor(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/* Сохранение прогресса между запусками. */
const SAVE_KEY = 'mini-gta-save-v1';
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
}
function writeSave(data) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* приватный режим */ }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* тихо */ }
}

/* ============================================================
   2. МИР
   ============================================================ */

const T_ROAD = 0;
const T_BUILD = 1;
const T_PARK = 2;
const T_SIDEWALK = 3;

const world = {
  tiles: null,          // тип клетки по индексу
  heights: null,        // высота дома — для объёма при отрисовке
  palette: null,        // цвет дома
};

const WORLD_CELLS = COLS * CELL;

function tileAt(cx, cy) {
  if (cx < 0 || cy < 0 || cx >= WORLD_CELLS || cy >= ROWS * CELL) return T_BUILD;
  return world.tiles[cy * WORLD_CELLS + cx];
}

function buildWorld() {
  const w = WORLD_CELLS;
  const h = ROWS * CELL;
  world.tiles = new Uint8Array(w * h);
  world.heights = new Float32Array(w * h);
  world.palette = new Uint8Array(w * h);

  const onRoad = (x, y) => (x % CELL === BLOCK) || (y % CELL === BLOCK);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (onRoad(x, y)) { world.tiles[i] = T_ROAD; continue; }

      const cx = x % CELL;
      const cy = y % CELL;
      const edge = cx === 0 || cx === BLOCK - 1 || cy === 0 || cy === BLOCK - 1;

      if (edge) {
        world.tiles[i] = T_SIDEWALK;
      } else {
        const blockX = Math.floor(x / CELL);
        const blockY = Math.floor(y / CELL);
        const park = ((blockX * 7 + blockY * 13) % 11) === 0;
        if (park) {
          world.tiles[i] = T_PARK;
        } else {
          world.tiles[i] = T_BUILD;
          world.heights[i] = 26 + ((blockX * 31 + blockY * 17) % 5) * 14;
          world.palette[i] = (blockX * 5 + blockY * 3) % 4;
        }
      }
    }
  }
}

/** Свободно ли место под круг: проверяем четыре угла квадрата. */
function isFree(x, y, r) {
  const pts = [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]];
  for (const [px, py] of pts) {
    if (tileAt(Math.floor(px / TILE), Math.floor(py / TILE)) === T_BUILD) return false;
  }
  return true;
}

/** Ближайшая точка на оси дороги — чтобы ставить машины и копов ровно. */
function nearestRoadPoint(x, y) {
  const cx = Math.floor(x / TILE);
  const cy = Math.floor(y / TILE);
  const rx = cx - (cx % CELL);
  const ry = cy - (cy % CELL);
  const centreR = (rx + BLOCK / 2) * TILE;
  const centreB = (ry + BLOCK / 2) * TILE;
  const laneR = (rx + BLOCK + 0.5) * TILE;
  const laneB = (ry + BLOCK + 0.5) * TILE;

  const options = [
    { x: laneR, y: centreB, horiz: false },
    { x: centreR, y: laneB, horiz: true },
  ];
  let best = options[0];
  let bestD = Infinity;
  for (const o of options) {
    const d = dist2(x, y, o.x, o.y);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

/* ============================================================
   3. СУЩНОСТИ
   ============================================================ */

const game = {
  state: 'menu',           // menu | playing | paused | dead
  dayTime: 12 * 60,        // часы суток в минутах
  shake: 0,
  wanted: 0,
  wantedTimer: 0,
  kills: 0,
  distance: 0,
  playtime: 0,
  camera: { x: 0, y: 0 },
};

const player = {
  x: 0, y: 0,
  vx: 0, vy: 0,
  angle: -Math.PI / 2,
  health: 100,
  armor: 0,
  money: 200,
  weapon: 0,
  ammo: [Infinity, 24, 12, 40],
  cooldown: 0,
  inCar: null,
  radius: 11,
  hitFlash: 0,
};

const WEAPONS = [
  { name: 'Кулаки', dmg: 6, rate: 0.32, range: 42, spread: 0, speed: 0, ammo: false },
  { name: 'Пистолет', dmg: 18, rate: 0.28, range: 520, spread: 0.05, speed: 900, ammo: true },
  { name: 'Дробовик', dmg: 42, rate: 0.85, range: 260, spread: 0.16, speed: 780, ammo: true, pellets: 5 },
  { name: 'Автомат', dmg: 14, rate: 0.1, range: 620, spread: 0.09, speed: 1100, ammo: true },
];

let cars = [];
let cops = [];
let peds = [];
let bullets = [];
let pickups = [];
let effects = [];

const CAR_COLORS = ['#c9d1d9', '#8b949e', '#4c8bf5', '#e05252', '#e0a020', '#3fb950', '#a371f7', '#e6edf3'];
const COP_COLOR = '#1f3a8a';

function makeCar(x, y, opts = {}) {
  return {
    x, y,
    angle: opts.angle ?? rnd(0, Math.PI * 2),
    speed: 0,
    maxSpeed: opts.maxSpeed ?? rnd(150, 230),
    accel: 190,
    brake: 320,
    steer: 2.1,
    w: 30, h: 56,
    color: opts.color ?? pick(CAR_COLORS),
    cop: !!opts.cop,
    hp: opts.cop ? 140 : 100,
    lane: opts.lane ?? null,     // { x, y, horiz } — ось, по которой едет трафик
    fireTimer: rnd(0.4, 1.6),
    player: false,
  };
}

function makePed(x, y) {
  return {
    x, y,
    angle: rnd(0, Math.PI * 2),
    speed: rnd(34, 58),
    color: pick(['#c9d1d9', '#a371f7', '#3fb950', '#e0a020', '#e05252', '#8b949e']),
    panic: 0,
    think: rnd(0, 2),
    hp: 30,
  };
}

function makePickup(x, y, kind) {
  return { x, y, kind, life: 26, bob: rnd(0, 6) };
}

/* ============================================================
   4. ВВОД
   ============================================================ */

const keys = Object.create(null);
const input = {
  mx: 0, my: 0,           // вектор движения
  stick: { x: 0, y: 0 },  // вектор от сенсорного джойстика
  fire: false,
  sprint: false,
  touchMode: false,
};

const settings = { shake: true, touch: false };

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const isTouchDevice = () => ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

function setupInput() {
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();

    if (k === 'escape') togglePause();
    if (k === 'e' || k === 'enter') doAction();
    if (k === 'f') shoot();
    if (['1', '2', '3', '4'].includes(k)) selectWeapon(Number(k) - 1);
  });
  addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) shoot(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /* — сенсорный джойстик — */
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stickKnob');
  let stickId = null;
  let origin = { x: 0, y: 0 };

  const start = (e) => {
    const t = e.changedTouches ? e.changedTouches[0] : e;
    const r = stick.getBoundingClientRect();
    stickId = t.identifier ?? 'mouse';
    origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    move(e);
  };
  const move = (e) => {
    if (stickId === null) return;
    const list = e.changedTouches ? [...e.changedTouches] : [e];
    const t = list.find((x) => (x.identifier ?? 'mouse') === stickId) || list[0];
    const r = stick.getBoundingClientRect();
    const max = r.width / 2 - 20;
    let dx = t.clientX - origin.x;
    let dy = t.clientY - origin.y;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, len / max);
    dx = (dx / len) * k;
    dy = (dy / len) * k;
    input.stick = { x: dx, y: dy };
    knob.style.transform = `translate(${dx * max}px, ${dy * max}px)`;
  };
  const end = () => {
    stickId = null;
    input.stick = { x: 0, y: 0 };
    knob.style.transform = 'translate(0,0)';
  };

  stick.addEventListener('touchstart', (e) => { e.preventDefault(); start(e); }, { passive: false });
  stick.addEventListener('touchmove', (e) => { e.preventDefault(); move(e); }, { passive: false });
  stick.addEventListener('touchend', (e) => { e.preventDefault(); end(); }, { passive: false });
  stick.addEventListener('touchcancel', end);
  stick.addEventListener('mousedown', (e) => { e.preventDefault(); start(e); });
  addEventListener('mousemove', move);
  addEventListener('mouseup', end);

  /* — экранные кнопки: работают и от касания, и от мыши — */
  const hold = (id, on, off) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); if (off) off(); }, { passive: false });
    el.addEventListener('mousedown', (e) => { e.preventDefault(); on(); });
    el.addEventListener('mouseup', () => { if (off) off(); });
    el.addEventListener('mouseleave', () => { if (off) off(); });
  };

  hold('btnAction', () => doAction());
  hold('btnFire', () => { input.fire = true; shoot(); }, () => { input.fire = false; });
  hold('btnSprint', () => { input.sprint = true; }, () => { input.sprint = false; });
  hold('btnWeapon', () => selectWeapon((player.weapon + 1) % WEAPONS.length));

  document.getElementById('btnPlay').addEventListener('click', () => startGame(false));
  document.getElementById('btnContinue').addEventListener('click', () => startGame(true));
  document.getElementById('btnHelp').addEventListener('click', () => show('help'));
  document.getElementById('btnHelpClose').addEventListener('click', () => hide('help'));
  document.getElementById('btnResume').addEventListener('click', () => togglePause());
  document.getElementById('btnRestart').addEventListener('click', () => { hide('pause'); startGame(false); });
  document.getElementById('btnToMenu').addEventListener('click', () => { hide('pause'); toMenu(); });
  document.getElementById('btnRespawn').addEventListener('click', respawn);
  document.getElementById('btnPause').addEventListener('click', () => togglePause());

  const optSound = document.getElementById('optSound');
  const optTouch = document.getElementById('optTouch');
  const optShake = document.getElementById('optShake');

  optSound.addEventListener('change', () => { audio.enabled = optSound.checked; });
  optShake.addEventListener('change', () => { settings.shake = optShake.checked; });
  optTouch.addEventListener('change', () => { settings.touch = optTouch.checked; applyTouchPref(); });
}

function applyTouchPref() {
  const showTouch = settings.touch && (isTouchDevice() || input.touchMode);
  document.getElementById('touch').classList.toggle('hidden', !showTouch || game.state !== 'playing');
}

/* ============================================================
   5. ЛОГИКА
   ============================================================ */

function spawnPlayer() {
  const p = nearestRoadPoint(WORLD_W / 2, WORLD_H / 2);
  player.x = p.x;
  player.y = p.y;
  player.vx = 0;
  player.vy = 0;
  player.inCar = null;
  player.health = 100;
  player.armor = 0;
  player.hitFlash = 0;
}

function spawnTraffic(n) {
  let tries = 0;
  while (cars.length < n && tries < 800) {
    tries++;
    const x = rnd(TILE * 2, WORLD_W - TILE * 2);
    const y = rnd(TILE * 2, WORLD_H - TILE * 2);
    const road = nearestRoadPoint(x, y);
    if (dist2(road.x, road.y, player.x, player.y) < 320 * 320) continue;
    if (!isFree(road.x, road.y, 34)) continue;
    const horizAngle = Math.random() < 0.5 ? 0 : Math.PI;
    const vertAngle = Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    cars.push(makeCar(road.x, road.y, {
      angle: road.horiz ? horizAngle : vertAngle,
      lane: { x: road.x, y: road.y, horiz: road.horiz },
    }));
  }
}

function spawnPeds(n) {
  peds = [];
  let tries = 0;
  while (peds.length < n && tries < 600) {
    tries++;
    const x = rnd(TILE * 2, WORLD_W - TILE * 2);
    const y = rnd(TILE * 2, WORLD_H - TILE * 2);
    if (tileAt(Math.floor(x / TILE), Math.floor(y / TILE)) !== T_SIDEWALK) continue;
    peds.push(makePed(x, y));
  }
}

/* — стрельба — */

function shoot() {
  if (game.state !== 'playing') return;
  const w = WEAPONS[player.weapon];
  if (player.cooldown > 0) return;
  if (w.ammo && player.ammo[player.weapon] <= 0) { toast('Патроны кончились'); return; }

  player.cooldown = w.rate;

  if (w.speed === 0) {
    // кулаки: бьём вблизи
    const reach = w.range;
    const fx = player.x + Math.cos(player.angle) * reach;
    const fy = player.y + Math.sin(player.angle) * reach;
    let hitSomething = false;
    for (const p of peds) {
      if (p.hp <= 0) continue;
      if (dist2(fx, fy, p.x, p.y) < 22 * 22) { p.hp -= w.dmg; hitSomething = true; audio.hit(); }
    }
    for (const c of cars) {
      if (dist2(fx, fy, c.x, c.y) < 30 * 30) { c.hp -= w.dmg; hitSomething = true; audio.hit(); }
    }
    effects.push({ kind: 'muzzle', x: fx, y: fy, life: 0.06, angle: player.angle });
    if (hitSomething) raiseWanted(1, 0.6);
    return;
  }

  const ox = player.x + Math.cos(player.angle) * 20;
  const oy = player.y + Math.sin(player.angle) * 20;
  const shots = w.pellets || 1;

  for (let i = 0; i < shots; i++) {
    const a = player.angle + rnd(-w.spread, w.spread);
    bullets.push({
      x: ox, y: oy,
      vx: Math.cos(a) * w.speed,
      vy: Math.sin(a) * w.speed,
      life: w.range / w.speed,
      dmg: w.dmg,
      from: 'player',
    });
  }

  if (w.ammo) player.ammo[player.weapon] -= 1;

  effects.push({ kind: 'muzzle', x: ox, y: oy, life: 0.06, angle: player.angle });
  game.shake = Math.max(game.shake, w.pellets ? 5 : 2.4);
  audio.shot(player.weapon);
  raiseWanted(1, 0.6);
  updateWeaponHud();
}

function selectWeapon(i) {
  if (i < 0 || i >= WEAPONS.length) return;
  player.weapon = i;
  updateWeaponHud();
  audio.click();
}

/* — розыск — */

function raiseWanted(stars, factor = 1) {
  const prev = game.wanted;
  game.wanted = clamp(Math.max(game.wanted, stars), 0, 5);
  game.wantedTimer = Math.max(game.wantedTimer, 22 * factor);
  if (game.wanted > prev) {
    updateStars();
    toast('Розыск: ' + game.wanted + '★');
    spawnCopsForWanted();
  }
}

function spawnCopsForWanted() {
  const want = game.wanted * (game.wanted >= 4 ? 2 : 1);
  for (let i = cops.length; i < Math.min(12, want); i++) {
    for (let t = 0; t < 40; t++) {
      const a = rnd(0, Math.PI * 2);
      const d = rnd(700, 1100);
      const x = clamp(player.x + Math.cos(a) * d, TILE * 2, WORLD_W - TILE * 2);
      const y = clamp(player.y + Math.sin(a) * d, TILE * 2, WORLD_H - TILE * 2);
      const road = nearestRoadPoint(x, y);
      if (!isFree(road.x, road.y, 36)) continue;
      cops.push(makeCar(road.x, road.y, {
        cop: true,
        maxSpeed: rnd(190, 230) + game.wanted * 12,
        color: COP_COLOR,
      }));
      break;
    }
  }
}

/* — сесть в машину и выйти — */

function doAction() {
  if (game.state !== 'playing') return;

  if (player.inCar) {
    const c = player.inCar;
    if (Math.abs(c.speed) > 200) { toast('Слишком быстро, чтобы выйти'); return; }
    const side = c.angle + Math.PI / 2;
    const ex = c.x + Math.cos(side) * 36;
    const ey = c.y + Math.sin(side) * 36;
    if (!isFree(ex, ey, 14)) { toast('Здесь не выйти'); return; }

    c.player = false;
    player.inCar = null;
    player.x = ex;
    player.y = ey;
    player.vx = 0;
    player.vy = 0;
    updateActionLabel();
    audio.click();
    return;
  }

  let best = null;
  let bestD = 78 * 78;
  for (const c of cars) {
    const d = dist2(player.x, player.y, c.x, c.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) { toast('Рядом нет машины'); return; }

  const stolenCop = best.cop;
  best.player = true;
  best.lane = null;
  player.inCar = best;
  updateActionLabel();
  audio.click();

  // угон — уже розыск, а угон полицейской машины тем более
  raiseWanted(stolenCop ? 2 : 1, 1);
}

/* — урон и смерть — */

function damagePlayer(amount) {
  if (player.inCar) {
    player.inCar.hp -= amount;
    if (player.inCar.hp > 0) {
      player.hitFlash = 0.12;
      game.shake = Math.max(game.shake, 3);
      return;
    }
    explodeCar(player.inCar, false);
    return;
  }

  if (player.armor > 0) {
    const absorbed = Math.min(player.armor, amount * 0.7);
    player.armor -= absorbed;
    amount -= absorbed;
  }
  player.health -= amount;
  player.hitFlash = 0.25;
  game.shake = Math.max(game.shake, 4);
  audio.hurt();
  if (player.health <= 0) die();
}

function die() {
  player.health = 0;
  game.state = 'dead';
  const lost = Math.floor(player.money * 0.25);
  player.money = Math.max(0, player.money - lost);

  document.getElementById('deadStats').innerHTML =
    statsHtml({ 'Потеряно денег': '$' + money(lost) });
  show('dead');
  hideHud();
  audio.die();
  clearSave();
}

function respawn() {
  hide('dead');
  player.health = 100;
  player.armor = 0;
  player.inCar = null;
  game.wanted = 0;
  game.wantedTimer = 0;
  cops = [];
  spawnPlayer();
  updateStars();
  updateActionLabel();
  game.state = 'playing';
  game.camera.x = player.x;
  game.camera.y = player.y;
  showHud();
}

/* ============================================================
   6. ОБНОВЛЕНИЕ
   ============================================================ */

function updateInputVector() {
  let ix = 0;
  let iy = 0;
  if (keys['a'] || keys['arrowleft'] || keys['ф']) ix -= 1;
  if (keys['d'] || keys['arrowright'] || keys['в']) ix += 1;
  if (keys['w'] || keys['arrowup'] || keys['ц']) iy -= 1;
  if (keys['s'] || keys['arrowdown'] || keys['ы']) iy += 1;

  const len = Math.hypot(ix, iy);
  if (len > 0) { ix /= len; iy /= len; }
  input.mx = ix;
  input.my = iy;

  if (Math.abs(input.stick.x) > 0.08 || Math.abs(input.stick.y) > 0.08) {
    input.mx = input.stick.x;
    input.my = input.stick.y;
  }

  if (keys['shift']) input.sprint = true;
  else if (!document.getElementById('btnSprint').matches(':active')) input.sprint = false;
}

/** Движение с раздельным разрешением по осям — так стены не липнут. */
function tryMove(ent, dx, dy, r) {
  if (isFree(ent.x + dx, ent.y, r)) ent.x += dx;
  if (isFree(ent.x, ent.y + dy, r)) ent.y += dy;
  ent.x = clamp(ent.x, TILE, WORLD_W - TILE);
  ent.y = clamp(ent.y, TILE, WORLD_H - TILE);
}

function updatePlayer(dt) {
  if (player.inCar) return;

  const speed = 132 * (input.sprint ? 1.7 : 1);
  const accel = clamp(12 * dt, 0, 1);

  player.vx = lerp(player.vx, input.mx * speed, accel);
  player.vy = lerp(player.vy, input.my * speed, accel);

  tryMove(player, player.vx * dt, player.vy * dt, player.radius);

  if (Math.hypot(input.mx, input.my) > 0.1) {
    const want = Math.atan2(input.my, input.mx);
    player.angle += angleDiff(player.angle, want) * clamp(14 * dt, 0, 1);
  }

  game.distance += Math.hypot(player.vx, player.vy) * dt * 0.02;

  // подбираем то, что рядом
  for (const p of pickups) {
    if (dist2(p.x, p.y, player.x, player.y) < 20 * 20) collect(p);
  }
}

function updateCars(dt) {
  for (const c of cars) {
    if (c.player) { updatePlayerCar(c, dt); continue; }
    if (c.cop) { updateCop(c, dt); continue; }

    if (!c.lane) { c.speed = lerp(c.speed, 0, clamp(3 * dt, 0, 1)); continue; }

    // держимся оси дороги
    const targetX = c.lane.horiz ? c.x : c.lane.x;
    const targetY = c.lane.horiz ? c.lane.y : c.y;
    const off = Math.hypot(targetX - c.x, targetY - c.y);
    if (off > 2) {
      const want = Math.atan2(targetY - c.y, targetX - c.x);
      c.angle += angleDiff(c.angle, want) * clamp(3 * dt, 0, 1);
    } else {
      const want = c.lane.horiz ? (Math.cos(c.angle) >= 0 ? 0 : Math.PI)
        : (Math.sin(c.angle) >= 0 ? Math.PI / 2 : -Math.PI / 2);
      c.angle += angleDiff(c.angle, want) * clamp(3 * dt, 0, 1);
    }

    // тормозим перед тем, что впереди
    let blocked = false;
    const fx = c.x + Math.cos(c.angle) * 48;
    const fy = c.y + Math.sin(c.angle) * 48;
    for (const o of cars) {
      if (o !== c && dist2(fx, fy, o.x, o.y) < 42 * 42) { blocked = true; break; }
    }
    for (const o of cops) {
      if (dist2(fx, fy, o.x, o.y) < 42 * 42) { blocked = true; break; }
    }
    if (!blocked && dist2(fx, fy, player.x, player.y) < 40 * 40) blocked = true;

    c.speed = blocked
      ? lerp(c.speed, 0, clamp(6 * dt, 0, 1))
      : lerp(c.speed, c.maxSpeed, clamp(1.1 * dt, 0, 1));

    const nx = c.x + Math.cos(c.angle) * c.speed * dt;
    const ny = c.y + Math.sin(c.angle) * c.speed * dt;
    if (isFree(nx, ny, 26)) { c.x = nx; c.y = ny; }
    else { c.angle += rnd(-1, 1) * 2 * dt; c.speed *= 0.6; }

    c.x = clamp(c.x, TILE, WORLD_W - TILE);
    c.y = clamp(c.y, TILE, WORLD_H - TILE);
  }
}

function updatePlayerCar(c, dt) {
  const throttle = -input.my;                  // вверх по экрану — газ
  const steer = input.mx;

  const gas = throttle > 0.1 || input.sprint;
  const brake = throttle < -0.1 || keys[' '];

  if (gas) c.speed += c.accel * dt * (throttle > 0.1 ? throttle : 1);
  else if (brake) c.speed -= c.brake * dt;
  else c.speed = lerp(c.speed, 0, clamp(0.9 * dt, 0, 1));

  c.speed = clamp(c.speed, -70, c.maxSpeed);

  // на скорости руль слушается хуже — как в жизни
  const grip = clamp(1 - Math.abs(c.speed) / (c.maxSpeed * 2.6), 0.35, 1);
  c.angle += steer * c.steer * grip * dt * (c.speed < 0 ? -1 : 1);

  const nx = c.x + Math.cos(c.angle) * c.speed * dt;
  const ny = c.y + Math.sin(c.angle) * c.speed * dt;

  if (isFree(nx, ny, 24)) {
    c.x = nx;
    c.y = ny;
  } else {
    if (Math.abs(c.speed) > 160) {
      damagePlayer(Math.abs(c.speed) / 45);
      audio.crash();
      game.shake = Math.max(game.shake, 7);
    }
    c.speed *= -0.25;
  }

  c.x = clamp(c.x, TILE, WORLD_W - TILE);
  c.y = clamp(c.y, TILE, WORLD_H - TILE);

  player.x = c.x;
  player.y = c.y;
  player.angle = c.angle;

  game.distance += Math.abs(c.speed) * dt * 0.02;

  // наезд на пешехода
  for (const p of peds) {
    if (p.hp > 0 && dist2(c.x, c.y, p.x, p.y) < 30 * 30 && Math.abs(c.speed) > 90) {
      p.hp = 0;
      game.kills++;
      raiseWanted(2, 1.2);
      audio.hit();
      effects.push({ kind: 'blood', x: p.x, y: p.y, life: 0.4 });
    }
  }

  // подбираем бонусы на ходу
  for (const p of pickups) {
    if (dist2(p.x, p.y, c.x, c.y) < 36 * 36) collect(p);
  }

  updateSpeedo(Math.abs(c.speed));
}

function updateCop(c, dt) {
  const target = player.inCar || player;
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  const d = Math.hypot(dx, dy) || 1;
  const want = Math.atan2(dy, dx);

  c.angle += angleDiff(c.angle, want) * clamp(2.4 * dt, 0, 1);

  const desired = d > 90 ? c.maxSpeed : 0;
  c.speed = lerp(c.speed, desired, clamp(1.6 * dt, 0, 1));

  const nx = c.x + Math.cos(c.angle) * c.speed * dt;
  const ny = c.y + Math.sin(c.angle) * c.speed * dt;
  if (isFree(nx, ny, 24)) { c.x = nx; c.y = ny; }
  else { c.speed *= 0.4; c.angle += rnd(-1, 1); }

  c.x = clamp(c.x, TILE, WORLD_W - TILE);
  c.y = clamp(c.y, TILE, WORLD_H - TILE);

  // таранят игрока
  if (d < 46 && Math.abs(c.speed) > 60) {
    damagePlayer(player.inCar ? 8 : 14);
    c.speed *= 0.3;
    audio.crash();
  }

  // стреляют, если игрок на ногах
  if (!player.inCar && d < 430) {
    c.fireTimer -= dt;
    if (c.fireTimer <= 0) {
      c.fireTimer = rnd(0.7, 1.8) / (1 + game.wanted * 0.25);
      const a = Math.atan2(dy, dx) + rnd(-0.12, 0.12);
      bullets.push({
        x: c.x + Math.cos(a) * 26,
        y: c.y + Math.sin(a) * 26,
        vx: Math.cos(a) * 820,
        vy: Math.sin(a) * 820,
        life: 0.6,
        dmg: 7 + game.wanted,
        from: 'cop',
      });
      audio.shot(1);
    }
  }
}

function updatePeds(dt) {
  for (const p of peds) {
    if (p.hp <= 0) continue;

    p.think -= dt;
    if (p.think <= 0) {
      p.think = rnd(1.2, 3.4);
      p.angle += rnd(-1.4, 1.4);
    }

    const nearPlayer = dist2(p.x, p.y, player.x, player.y) < 220 * 220;
    if (nearPlayer && (player.weapon > 0 || game.wanted > 0)) p.panic = 2;

    let speed = p.speed;
    if (p.panic > 0) {
      p.panic -= dt;
      p.angle = Math.atan2(p.y - player.y, p.x - player.x);
      speed *= 2.1;
    }

    const nx = p.x + Math.cos(p.angle) * speed * dt;
    const ny = p.y + Math.sin(p.angle) * speed * dt;
    if (isFree(nx, ny, 9)) { p.x = nx; p.y = ny; }
    else p.angle += rnd(-1.5, 1.5);
  }
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    let dead = b.life <= 0;

    if (!dead && tileAt(Math.floor(b.x / TILE), Math.floor(b.y / TILE)) === T_BUILD) {
      dead = true;
      effects.push({ kind: 'spark', x: b.x, y: b.y, life: 0.2 });
    }

    if (!dead && b.from === 'player') {
      for (const c of cars) {
        if (dist2(b.x, b.y, c.x, c.y) < 26 * 26) {
          c.hp -= b.dmg;
          dead = true;
          effects.push({ kind: 'spark', x: b.x, y: b.y, life: 0.2 });
          if (c.hp <= 0) explodeCar(c);
          break;
        }
      }

      if (!dead) {
        for (const p of peds) {
          if (p.hp <= 0) continue;
          if (dist2(b.x, b.y, p.x, p.y) < 13 * 13) {
            p.hp -= b.dmg;
            dead = true;
            audio.hit();
            effects.push({ kind: 'blood', x: b.x, y: b.y, life: 0.4 });
            if (p.hp <= 0) { game.kills++; raiseWanted(2, 1.1); }
            break;
          }
        }
      }

      if (!dead) {
        for (const c of cops) {
          if (dist2(b.x, b.y, c.x, c.y) < 26 * 26) {
            c.hp -= b.dmg;
            dead = true;
            effects.push({ kind: 'spark', x: b.x, y: b.y, life: 0.2 });
            if (c.hp <= 0) explodeCar(c);
            break;
          }
        }
      }
    }

    if (!dead && b.from === 'cop') {
      const target = player.inCar || player;
      const r = player.inCar ? 26 : 13;
      if (dist2(b.x, b.y, target.x, target.y) < r * r) {
        damagePlayer(b.dmg);
        dead = true;
        effects.push({ kind: 'spark', x: b.x, y: b.y, life: 0.2 });
      }
    }

    if (dead) bullets.splice(i, 1);
  }
}

/** Взрыв машины: урон вокруг, деньги в награду. */
function explodeCar(c, hurtPlayer = true) {
  effects.push({ kind: 'explosion', x: c.x, y: c.y, life: 0.7 });
  audio.explosion();
  game.shake = Math.max(game.shake, 12);

  const wasPlayerCar = c.player || player.inCar === c;

  const ci = cars.indexOf(c);
  if (ci >= 0) cars.splice(ci, 1);
  const ki = cops.indexOf(c);
  if (ki >= 0) cops.splice(ki, 1);

  if (wasPlayerCar) {
    player.inCar = null;
    updateActionLabel();
    if (hurtPlayer) damagePlayer(45);
  }

  // из машины сыплются деньги, иногда аптечка или броня
  for (let i = 0, n = rndInt(2, 5); i < n; i++) {
    pickups.push(makePickup(c.x + rnd(-30, 30), c.y + rnd(-30, 30), 'cash'));
  }
  if (Math.random() < 0.35) pickups.push(makePickup(c.x + rnd(-24, 24), c.y + rnd(-24, 24), 'health'));
  if (Math.random() < 0.25) pickups.push(makePickup(c.x + rnd(-24, 24), c.y + rnd(-24, 24), 'armor'));
}

function collect(p) {
  const idx = pickups.indexOf(p);
  if (idx >= 0) pickups.splice(idx, 1);

  if (p.kind === 'cash') {
    const amount = rndInt(15, 60);
    player.money += amount;
    toast('+' + amount + '$');
    audio.coin();
  } else if (p.kind === 'health') {
    player.health = Math.min(100, player.health + 25);
    toast('+25 здоровья');
    audio.coin();
  } else if (p.kind === 'armor') {
    player.armor = Math.min(100, player.armor + 30);
    toast('+30 брони');
    audio.coin();
  } else if (p.kind === 'ammo') {
    player.ammo[1] += 12;
    toast('+12 патронов');
    audio.coin();
  }
}

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.life -= dt;
    p.bob += dt * 3;
    if (p.life <= 0) pickups.splice(i, 1);
  }
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    effects[i].life -= dt;
    if (effects[i].life <= 0) effects.splice(i, 1);
  }
  game.shake = Math.max(0, game.shake - dt * 26);
  player.hitFlash = Math.max(0, player.hitFlash - dt);
  player.cooldown = Math.max(0, player.cooldown - dt);
}

function updateWanted(dt) {
  if (game.wanted <= 0) return;

  game.wantedTimer -= dt;
  if (game.wantedTimer > 0) return;

  let near = false;
  for (const c of cops) {
    if (dist2(c.x, c.y, player.x, player.y) < 520 * 520) { near = true; break; }
  }

  if (near) { game.wantedTimer = 8; return; }

  game.wanted -= 1;
  game.wantedTimer = 20;
  updateStars();
  if (game.wanted === 0) { cops = []; toast('Розыск снят'); }
  else toast('Розыск: ' + game.wanted + '★');
}

function update(dt) {
  game.playtime += dt;
  game.dayTime = (game.dayTime + dt * 0.6) % 1440;

  updateInputVector();
  updatePlayer(dt);
  updateCars(dt);
  updatePeds(dt);
  updateBullets(dt);
  updatePickups(dt);
  updateWanted(dt);
  updateEffects(dt);

  if (input.fire) shoot();

  // камера чуть заглядывает вперёд по направлению движения
  const target = player.inCar || player;
  const lead = player.inCar ? 0.28 : 0.12;
  const camX = target.x + Math.cos(player.angle) * 90 * lead;
  const camY = target.y + Math.sin(player.angle) * 90 * lead;
  game.camera.x = lerp(game.camera.x, camX, clamp(6 * dt, 0, 1));
  game.camera.y = lerp(game.camera.y, camY, clamp(6 * dt, 0, 1));

  // в покое здоровье потихоньку возвращается
  if (player.health > 0 && player.health < 100 && game.wanted === 0) {
    player.health = Math.min(100, player.health + dt * 0.9);
  }

  updateHud();
}

/* ============================================================
   7. ОТРИСОВКА
   ============================================================ */

let viewW = 0;
let viewH = 0;
let dpr = 1;

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  viewW = canvas.clientWidth || window.innerWidth;
  viewH = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.floor(viewW * dpr);
  canvas.height = Math.floor(viewH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const BUILD_COLORS = ['#2b3442', '#333d4d', '#263041', '#3a4454'];
const BUILD_TOP = ['#39445a', '#414d66', '#333e52', '#4a5670'];

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawWorld(camX, camY) {
  const x0 = Math.max(0, Math.floor((camX - viewW / 2) / TILE) - 1);
  const x1 = Math.min(WORLD_CELLS - 1, Math.ceil((camX + viewW / 2) / TILE) + 1);
  const y0 = Math.max(0, Math.floor((camY - viewH / 2) / TILE) - 1);
  const y1 = Math.min(ROWS * CELL - 1, Math.ceil((camY + viewH / 2) / TILE) + 1);

  ctx.fillStyle = '#1b2129';
  ctx.fillRect(camX - viewW / 2, camY - viewH / 2, viewW, viewH);

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const i = ty * WORLD_CELLS + tx;
      const t = world.tiles[i];
      const px = tx * TILE;
      const py = ty * TILE;

      if (t === T_ROAD) continue;

      if (t === T_PARK) {
        ctx.fillStyle = '#1e3a26';
        ctx.fillRect(px, py, TILE, TILE);
        continue;
      }

      if (t === T_SIDEWALK) {
        ctx.fillStyle = '#2a313b';
        ctx.fillRect(px, py, TILE, TILE);
        continue;
      }

      const hgt = world.heights[i];
      const pal = world.palette[i];

      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.fillRect(px + 7, py + hgt * 0.35 + 7, TILE + 3, TILE + 3);

      ctx.fillStyle = BUILD_COLORS[pal];
      ctx.fillRect(px, py + hgt * 0.12, TILE, TILE);

      ctx.fillStyle = BUILD_TOP[pal];
      ctx.fillRect(px, py, TILE, TILE - 3);

      ctx.fillStyle = 'rgba(255,220,150,0.16)';
      for (let wy = 0; wy < 3; wy++) {
        for (let wx = 0; wx < 3; wx++) {
          if (((tx * 7 + ty * 13 + wx * 3 + wy * 5) % 5) === 0) continue;
          ctx.fillRect(px + 12 + wx * 22, py + 12 + wy * 22, 12, 12);
        }
      }
    }
  }

  // разметка дорог
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 3;
  ctx.setLineDash([26, 26]);
  ctx.beginPath();
  for (let by = 0; by < ROWS; by++) {
    const y = (by * CELL + BLOCK + 0.5) * TILE;
    if (y < camY - viewH / 2 - 60 || y > camY + viewH / 2 + 60) continue;
    ctx.moveTo(camX - viewW / 2, y);
    ctx.lineTo(camX + viewW / 2, y);
  }
  for (let bx = 0; bx < COLS; bx++) {
    const x = (bx * CELL + BLOCK + 0.5) * TILE;
    if (x < camX - viewW / 2 - 60 || x > camX + viewW / 2 + 60) continue;
    ctx.moveTo(x, camY - viewH / 2);
    ctx.lineTo(x, camY + viewH / 2);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCar(c) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.angle);

  const w = c.w;
  const h = c.h;

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(-w / 2 + 3, -h / 2 + 4, w, h);

  ctx.fillStyle = c.color;
  roundRect(-w / 2, -h / 2, w, h, 7);
  ctx.fill();

  ctx.fillStyle = 'rgba(12,18,26,0.75)';
  roundRect(-w / 2 + 4, -h / 2 + 8, w - 8, 14, 3);
  ctx.fill();
  roundRect(-w / 2 + 4, h / 2 - 20, w - 8, 12, 3);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  roundRect(-w / 2 + 5, -6, w - 10, 12, 3);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,240,190,0.9)';
  ctx.fillRect(-w / 2 + 4, -h / 2 + 1, 6, 4);
  ctx.fillRect(w / 2 - 10, -h / 2 + 1, 6, 4);

  if (c.cop) {
    const blink = Math.sin(game.playtime * 12) > 0;
    ctx.fillStyle = blink ? '#ff4d4d' : '#3b82f6';
    ctx.fillRect(-w / 2 + 4, -4, 8, 8);
    ctx.fillStyle = blink ? '#3b82f6' : '#ff4d4d';
    ctx.fillRect(w / 2 - 12, -4, 8, 8);
  }

  ctx.restore();

  if (c.hp < 100) {
    const pct = clamp(c.hp / 100, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(c.x - 16, c.y - 36, 32, 4);
    ctx.fillStyle = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#ffb020' : '#ff4d4d';
    ctx.fillRect(c.x - 16, c.y - 36, 32 * pct, 4);
  }
}

function drawPed(p) {
  if (p.hp <= 0) {
    ctx.fillStyle = 'rgba(120,20,20,0.7)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.arc(3, 3, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(20,26,34,0.9)';
  ctx.beginPath(); ctx.arc(4, 0, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  if (player.inCar) return;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.angle);

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.arc(3, 4, 12, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = player.hitFlash > 0 ? '#ffffff' : '#e6edf3';
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#ffb020';
  ctx.beginPath(); ctx.arc(5, 0, 4.6, 0, Math.PI * 2); ctx.fill();

  if (player.weapon > 0) {
    ctx.fillStyle = '#1b2129';
    ctx.fillRect(8, -2, 14, 4);
  }
  ctx.restore();
}

function drawBullets() {
  for (const b of bullets) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.atan2(b.vy, b.vx));
    ctx.fillStyle = b.from === 'player' ? 'rgba(255,225,150,0.95)' : 'rgba(255,150,150,0.95)';
    ctx.fillRect(-8, -1.5, 16, 3);
    ctx.restore();
  }
}

function drawPickups() {
  for (const p of pickups) {
    const y = p.y + Math.sin(p.bob) * 3;
    const fade = p.life < 4 ? 0.35 + 0.65 * Math.abs(Math.sin(p.life * 6)) : 1;
    ctx.globalAlpha = fade;

    if (p.kind === 'cash') {
      ctx.fillStyle = '#4ade80';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('$', p.x, y + 6);
    } else if (p.kind === 'health') {
      ctx.fillStyle = '#ff6b6b';
      ctx.fillRect(p.x - 8, y - 2.5, 16, 5);
      ctx.fillRect(p.x - 2.5, y - 8, 5, 16);
    } else if (p.kind === 'armor') {
      ctx.fillStyle = '#60a5fa';
      ctx.beginPath();
      ctx.moveTo(p.x, y - 9);
      ctx.lineTo(p.x + 8, y - 3);
      ctx.lineTo(p.x + 6, y + 8);
      ctx.lineTo(p.x - 6, y + 8);
      ctx.lineTo(p.x - 8, y - 3);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = '#ffb020';
      ctx.fillRect(p.x - 6, y - 6, 12, 12);
    }
    ctx.globalAlpha = 1;
  }
}

function drawEffects() {
  for (const e of effects) {
    const t = e.life;

    if (e.kind === 'muzzle') {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.angle);
      ctx.fillStyle = 'rgba(255,220,140,0.9)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(16, -7);
      ctx.lineTo(22, 0);
      ctx.lineTo(16, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (e.kind === 'spark') {
      ctx.fillStyle = `rgba(255,210,120,${clamp(t * 4, 0, 1)})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 8 * (1 - t * 4) + 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.kind === 'blood') {
      ctx.fillStyle = `rgba(160,30,30,${clamp(t * 2, 0, 1)})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 10, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.kind === 'explosion') {
      const k = 1 - t / 0.7;
      const r = 20 + k * 60;
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      g.addColorStop(0, `rgba(255,240,180,${clamp(1 - k, 0, 1)})`);
      g.addColorStop(0.5, `rgba(255,140,40,${clamp(0.8 - k * 0.8, 0, 1)})`);
      g.addColorStop(1, 'rgba(60,20,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawMinimap() {
  const mm = document.getElementById('minimap');
  const m = mm.getContext('2d');
  const size = mm.width;
  const span = 1500;
  const scale = size / span;
  const target = player.inCar || player;

  m.setTransform(1, 0, 0, 1, 0, 0);
  m.clearRect(0, 0, size, size);
  m.fillStyle = 'rgba(10,14,20,0.88)';
  m.fillRect(0, 0, size, size);

  m.save();
  m.translate(size / 2, size / 2);
  m.scale(scale, scale);
  m.translate(-target.x, -target.y);

  m.strokeStyle = 'rgba(255,255,255,0.22)';
  m.lineWidth = BLOCK * TILE * 0.5;
  m.beginPath();
  for (let by = 0; by <= ROWS; by++) {
    const y = (by * CELL + BLOCK / 2) * TILE;
    m.moveTo(0, y);
    m.lineTo(WORLD_W, y);
  }
  for (let bx = 0; bx <= COLS; bx++) {
    const x = (bx * CELL + BLOCK / 2) * TILE;
    m.moveTo(x, 0);
    m.lineTo(x, WORLD_H);
  }
  m.stroke();

  m.fillStyle = '#3b82f6';
  for (const c of cops) m.fillRect(c.x - 40, c.y - 40, 80, 80);

  m.fillStyle = '#ffb020';
  m.beginPath();
  m.arc(target.x, target.y, 55, 0, Math.PI * 2);
  m.fill();

  m.restore();
}

function render() {
  const shaking = settings.shake && game.shake > 0;
  const camX = game.camera.x + (shaking ? rnd(-game.shake, game.shake) : 0);
  const camY = game.camera.y + (shaking ? rnd(-game.shake, game.shake) : 0);

  ctx.save();
  ctx.translate(viewW / 2 - camX, viewH / 2 - camY);

  drawWorld(camX, camY);

  // сортировка по Y: то, что ниже на экране, рисуется поверх
  const drawables = [];
  for (const c of cars) drawables.push({ y: c.y, fn: () => drawCar(c) });
  for (const c of cops) drawables.push({ y: c.y, fn: () => drawCar(c) });
  for (const p of peds) drawables.push({ y: p.y, fn: () => drawPed(p) });
  if (!player.inCar) drawables.push({ y: player.y, fn: drawPlayer });
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.fn();

  drawPickups();
  drawBullets();
  drawEffects();

  ctx.restore();

  if (player.hitFlash > 0) {
    ctx.fillStyle = `rgba(180,20,20,${player.hitFlash * 0.8})`;
    ctx.fillRect(0, 0, viewW, viewH);
  }

  // ночь по часам суток
  const hour = game.dayTime / 60;
  const night = (hour < 6 || hour > 20) ? 0.34 : (hour < 8 || hour > 18) ? 0.17 : 0;
  if (night > 0) {
    ctx.fillStyle = `rgba(6,10,20,${night})`;
    ctx.fillRect(0, 0, viewW, viewH);
  }

  drawMinimap();
}

/* ============================================================
   8. ИНТЕРФЕЙС
   ============================================================ */

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');

function showHud() {
  show('hud');
  show('mapWrap');
  show('btnPause');
  applyTouchPref();
}

function hideHud() {
  hide('hud');
  hide('mapWrap');
  hide('btnPause');
  hide('touch');
}

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

let hintTimer = 0;
function hint(text) {
  const el = $('hint');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.remove('show'), 3400);
}

function updateHud() {
  $('healthBar').style.width = clamp(player.health, 0, 100) + '%';

  const armorWrap = $('armorWrap');
  if (player.armor > 0) {
    armorWrap.classList.remove('hidden');
    $('armorBar').style.width = clamp(player.armor, 0, 100) + '%';
  } else {
    armorWrap.classList.add('hidden');
  }

  $('money').textContent = money(player.money);

  const h = Math.floor(game.dayTime / 60);
  const m = Math.floor(game.dayTime % 60);
  $('clock').textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');

  const inCar = !!player.inCar;
  $('speedo').classList.toggle('hidden', !inCar);
  $('weapon').classList.toggle('hidden', inCar);
}

function updateSpeedo(speed) {
  $('speedVal').textContent = Math.round(speed / 3.2);
}

function updateWeaponHud() {
  const w = WEAPONS[player.weapon];
  $('weaponName').textContent = w.name;

  const ammo = $('ammo');
  if (w.ammo) {
    ammo.classList.remove('hidden');
    ammo.textContent = player.ammo[player.weapon];
  } else {
    ammo.classList.add('hidden');
  }

  const btn = $('btnWeapon');
  if (btn) btn.textContent = w.name.toUpperCase().slice(0, 10);
}

function updateActionLabel() {
  const btn = $('btnAction');
  if (!btn) return;
  btn.textContent = player.inCar ? 'ВЫЙТИ' : 'В МАШИНУ';
  $('btnSprint').textContent = player.inCar ? 'ГАЗ' : 'БЕГ';
}

function updateStars() {
  const host = $('stars');
  host.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const s = document.createElement('i');
    s.className = 'star' + (i < game.wanted ? '' : ' dim');
    host.appendChild(s);
  }
}

function statsHtml(extra = {}) {
  const rows = {
    'Денег': '$' + money(player.money),
    'Устранено': game.kills,
    'Пройдено, км': game.distance.toFixed(1),
    'Розыск': game.wanted + '★',
    ...extra,
  };
  return Object.entries(rows)
    .map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`)
    .join('');
}

/* — звук на Web Audio, без файлов — */

const audio = {
  enabled: true,
  ctx: null,
  init() {
    if (this.ctx) return;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = Ctor ? new Ctor() : null;
    } catch { this.ctx = null; }
  },
  beep(freq, dur, type = 'square', vol = 0.05) {
    if (!this.enabled || !this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.4), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  },
  shot(kind = 1) {
    if (kind === 0) { this.beep(160, 0.05, 'square', 0.03); return; }
    if (kind === 2) { this.beep(120, 0.16, 'sawtooth', 0.07); return; }
    if (kind === 3) { this.beep(320, 0.05, 'square', 0.04); return; }
    this.beep(420, 0.07, 'square', 0.05);
  },
  hit() { this.beep(220, 0.09, 'triangle', 0.05); },
  hurt() { this.beep(180, 0.18, 'sawtooth', 0.06); },
  crash() { this.beep(90, 0.2, 'sawtooth', 0.07); },
  explosion() { this.beep(60, 0.5, 'sawtooth', 0.1); },
  coin() { this.beep(880, 0.08, 'sine', 0.05); },
  click() { this.beep(520, 0.03, 'sine', 0.03); },
  die() { this.beep(140, 0.8, 'sawtooth', 0.09); },
};

/* ============================================================
   9. СОСТОЯНИЯ ИГРЫ
   ============================================================ */

function startGame(continueSave) {
  audio.init();

  const save = continueSave ? loadSave() : null;
  clearSave();

  buildWorld();
  cars = [];
  cops = [];
  bullets = [];
  pickups = [];
  effects = [];

  player.weapon = 0;
  player.ammo = [Infinity, 24, 12, 40];
  player.money = save && save.money ? save.money : 200;
  player.health = 100;
  player.armor = save && save.armor ? save.armor : 0;

  game.wanted = 0;
  game.wantedTimer = 0;
  game.kills = 0;
  game.distance = 0;
  game.shake = 0;
  game.dayTime = 12 * 60;
  game.playtime = 0;

  spawnPlayer();
  game.camera.x = player.x;
  game.camera.y = player.y;

  spawnTraffic(18);
  spawnPeds(26);

  // немного бонусов вокруг старта, чтобы было куда идти
  for (let i = 0; i < 5; i++) {
    const a = rnd(0, Math.PI * 2);
    const d = rnd(180, 460);
    pickups.push(makePickup(
      clamp(player.x + Math.cos(a) * d, TILE, WORLD_W - TILE),
      clamp(player.y + Math.sin(a) * d, TILE, WORLD_H - TILE),
      pick(['cash', 'cash', 'cash', 'health', 'ammo']),
    ));
  }

  hide('menu');
  hide('help');
  hide('pause');
  hide('dead');

  game.state = 'playing';
  showHud();
  updateStars();
  updateWeaponHud();
  updateActionLabel();
  hint('Найди машину и нажми «В МАШИНУ»');
}

function togglePause() {
  if (game.state === 'playing') {
    game.state = 'paused';
    $('pauseStats').innerHTML = statsHtml();
    show('pause');
    hide('touch');
  } else if (game.state === 'paused') {
    game.state = 'playing';
    hide('pause');
    applyTouchPref();
  }
}

function toMenu() {
  game.state = 'menu';
  saveProgress();
  hideHud();
  hide('menu');
  hide('help');
  hide('pause');
  hide('dead');
  show('menu');
  refreshMenu();
}

function saveProgress() {
  if (player.money > 200 || player.armor > 0) {
    writeSave({ money: player.money, armor: player.armor, at: Date.now() });
  }
}

function refreshMenu() {
  const save = loadSave();
  const btn = $('btnContinue');
  const info = $('saveInfo');

  if (save && (save.money > 200 || save.armor > 0)) {
    btn.classList.remove('hidden');
    info.textContent = 'Сохранение: $' + money(save.money);
  } else {
    btn.classList.add('hidden');
    info.textContent = '';
  }
}

/* ============================================================
   10. ИГРОВОЙ ЦИКЛ
   ============================================================ */

let last = 0;
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);

  if (!last) last = now;
  let delta = (now - last) / 1000;
  last = now;
  if (delta > 0.25) delta = 0.25;      // после сворачивания вкладки

  if (game.state === 'playing') {
    acc += delta;
    let guard = 0;
    while (acc >= STEP && guard < 5) { update(STEP); acc -= STEP; guard++; }
    render();
  } else if (game.state === 'paused' || game.state === 'dead') {
    render();
  }
}

/* ============================================================
   11. СТАРТ
   ============================================================ */

addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 200));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') togglePause();
});

if (isTouchDevice()) {
  input.touchMode = true;
  settings.touch = true;
  $('optTouch').checked = true;
}

/* Отладочный доступ: удобно проверять механику и смотреть состояние извне.
   На игру не влияет — только читает данные и умеет поставить машину рядом. */
window.__miniGTA = {
  state: () => ({
    mode: game.state,
    player: { x: Math.round(player.x), y: Math.round(player.y), health: Math.round(player.health), armor: Math.round(player.armor), money: player.money, inCar: !!player.inCar, weapon: WEAPONS[player.weapon].name },
    wanted: game.wanted,
    cars: cars.length,
    cops: cops.length,
    peds: peds.length,
    pickups: pickups.length,
    bullets: bullets.length,
  }),
  /** Поставить машину рядом с игроком — чтобы проверить угон без блужданий. */
  spawnCarNear: () => {
    const a = rnd(0, Math.PI * 2);
    for (let d = 60; d <= 200; d += 20) {
      const x = clamp(player.x + Math.cos(a) * d, TILE * 2, WORLD_W - TILE * 2);
      const y = clamp(player.y + Math.sin(a) * d, TILE * 2, WORLD_H - TILE * 2);
      if (!isFree(x, y, 34)) continue;
      const c = makeCar(x, y, { angle: a + Math.PI / 2 });
      cars.push(c);
      return true;
    }
    return false;
  },
  /** Подтянуть игрока к ближайшей машине — для проверок. */
  snapToNearestCar: () => {
    let best = null, bestD = Infinity;
    for (const c of cars) {
      const d = dist2(player.x, player.y, c.x, c.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) return null;
    player.x = best.x + 40;
    player.y = best.y;
    return { x: Math.round(best.x), y: Math.round(best.y), dist: Math.round(Math.sqrt(bestD)) };
  },
  action: () => doAction(),
  shoot: () => shoot(),
  /** Нанести урон именно игроку, минуя машину и броню — для проверок. */
  hurt: (n) => {
    player.armor = 0;
    const inCar = player.inCar;
    player.inCar = null;
    damagePlayer(n);
    player.inCar = inCar;
  },
  /** Выбрать оружие: 0 кулаки, 1 пистолет, 2 дробовик, 3 автомат. */
  weapon: (i) => selectWeapon(i),
};

resize();
setupInput();
updateStars();
updateActionLabel();
updateWeaponHud();
refreshMenu();
requestAnimationFrame(frame);

})();
