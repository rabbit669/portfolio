/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — состояние системы
   Корзина, вишлист, очередь, заказы, рефералы. Всё локально, всё переживает
   перезагрузку. Бэкенда нет — значит, источник истины здесь.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  PRODUCTS, CURRENT_DROP, QUEUE_BASE, REFERRAL_REWARD,
  DELIVERY, FREE_SHIPPING_FROM, productById, productsOfDrop, totalStock,
} from './data.js';
import { safeStore, sleep } from './util.js';

const KEY = 'ashen.state.v1';
const VISIT_KEY = 'ashen.visits';

const EMPTY = {
  cart: [],          // [{ id, size, qty }]
  wishlist: [],      // [id]
  waitlist: [],      // [productId]
  user: null,        // { email, name, since }
  queue: null,       // { position, base, email, friends, invited, joinKey }
  orders: [],        // [{ number, at, items, total, method, delivery, status }]
  notif: { email: true, push: false },
  referredBy: null,  // чей-то код, если пришёл по ссылке
};

/* ── ядро ──────────────────────────────────────────────────────────────── */

let state = { ...EMPTY, ...safeStore.get(KEY, {}) };
const listeners = new Set();

function persist() {
  safeStore.set(KEY, state);
}

export const store = {
  get: () => state,

  /** patch — объект с изменениями; подписчиков уведомляем один раз. */
  set(patch) {
    state = { ...state, ...patch };
    persist();
    listeners.forEach((fn) => fn(state));
    return state;
  },

  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** Уведомить подписчиков без изменения состояния (например, при загрузке). */
export function emit() {
  listeners.forEach((fn) => fn(state));
}

/* ── корзина ───────────────────────────────────────────────────────────── */

const lineKey = (id, size) => `${id}::${size || '-'}`;

export const cart = {
  items: () => state.cart,

  /** Развёрнутые позиции: товар + выбранный размер + количество. */
  detailed() {
    return state.cart
      .map((line) => {
        const product = productById(line.id);
        if (!product) return null;
        const unit = product.price;
        return { ...line, product, unit, sum: unit * line.qty, key: lineKey(line.id, line.size) };
      })
      .filter(Boolean);
  },

  count: () => state.cart.reduce((n, l) => n + l.qty, 0),

  subtotal() {
    return cart.detailed().reduce((s, l) => s + l.sum, 0);
  },

  has(id, size = null) {
    return state.cart.some((l) => l.id === id && (size === null || l.size === size));
  },

  add(id, size = null, qty = 1) {
    const product = productById(id);
    if (!product) return false;
    const key = lineKey(id, size);
    const next = [...state.cart];
    const i = next.findIndex((l) => lineKey(l.id, l.size) === key);
    if (i >= 0) {
      const limit = product.sizes?.[size] ?? 9;
      next[i] = { ...next[i], qty: Math.min(limit || 9, next[i].qty + qty) };
    } else {
      next.push({ id, size, qty });
    }
    store.set({ cart: next });
    return true;
  },

  setQty(key, qty) {
    const next = state.cart
      .map((l) => (lineKey(l.id, l.size) === key ? { ...l, qty: Math.max(0, qty) } : l))
      .filter((l) => l.qty > 0);
    store.set({ cart: next });
  },

  remove(key) {
    store.set({ cart: state.cart.filter((l) => lineKey(l.id, l.size) !== key) });
  },

  clear() {
    store.set({ cart: [] });
  },
};

export { lineKey };

/* ── вишлист ───────────────────────────────────────────────────────────── */

export const wishlist = {
  ids: () => state.wishlist,
  has: (id) => state.wishlist.includes(id),
  count: () => state.wishlist.length,
  toggle(id) {
    const on = state.wishlist.includes(id);
    store.set({ wishlist: on ? state.wishlist.filter((x) => x !== id) : [...state.wishlist, id] });
    return !on;
  },
  products() {
    return state.wishlist.map(productById).filter(Boolean);
  },
};

/* ── лист ожидания по товару ───────────────────────────────────────────── */

export const waitlist = {
  ids: () => state.waitlist,
  has: (id) => state.waitlist.includes(id),
  toggle(id) {
    const on = state.waitlist.includes(id);
    store.set({ waitlist: on ? state.waitlist.filter((x) => x !== id) : [...state.waitlist, id] });
    return !on;
  },
};

/* ── очередь на дроп ───────────────────────────────────────────────────── */

export const queue = {
  entry: () => state.queue,

  /** Позиция в очереди: база минус подъём за рефералов. */
  position() {
    if (!state.queue) return null;
    const lift = (state.queue.friends || 0) * REFERRAL_REWARD.perFriend;
    return Math.max(1, state.queue.base - lift);
  },

  size() {
    return QUEUE_BASE + (state.queue ? 1 : 0) + (state.queue?.friends || 0);
  },

  invites() {
    const f = state.queue?.friends || 0;
    return Math.floor(f / REFERRAL_REWARD.inviteEvery);
  },

  /** Класс доступа — от него зависит, когда откроется дроп. */
  access() {
    if (!state.queue) return { key: 'none', label: 'Нет доступа', lead: 0 };
    const f = state.queue.friends || 0;
    if (f >= 6) return { key: 'inner', label: 'Свои · ядро', lead: REFERRAL_REWARD.inviteLeadHours + 12 };
    if (f >= 3) return { key: 'member', label: 'Свои · инвайт', lead: REFERRAL_REWARD.inviteLeadHours };
    return { key: 'queued', label: 'В очереди', lead: 0 };
  },

  join({ email, name = '' } = {}) {
    if (state.queue && state.queue.email === email) return state.queue;
    const base = QUEUE_BASE + 1 + Math.floor(Math.random() * 240);
    const entry = {
      position: null,
      base,
      email: email || state.user?.email || '',
      friends: state.queue?.friends || 0,
      joinKey: `ASH-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      at: Date.now(),
    };
    const user = state.user || (email ? { email, name, since: Date.now() } : null);
    store.set({ queue: entry, user, notif: { ...state.notif, email: true } });
    return entry;
  },

  /** Пришёл по чужой ссылке — запоминаем и поднимаем пригласившего. */
  acceptInvite(code) {
    if (!code || state.referredBy === code) return false;
    store.set({ referredBy: code });
    return true;
  },

  addFriend() {
    if (!state.queue) return null;
    const entry = { ...state.queue, friends: (state.queue.friends || 0) + 1 };
    store.set({ queue: entry });
    return entry;
  },

  code() {
    return state.queue?.joinKey || null;
  },

  referralLink() {
    const code = queue.code();
    if (!code) return null;
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('ref', code);
    url.hash = '';
    return url.toString();
  },
};

/* ── пользователь ──────────────────────────────────────────────────────── */

export const user = {
  get: () => state.user,
  signedIn: () => !!state.user,
  signIn({ email, name = '' }) {
    const next = state.user || { email, name, since: Date.now() };
    store.set({ user: next });
    return next;
  },
  signOut() {
    store.set({ user: null });
  },
  rename(name) {
    if (!state.user) return;
    store.set({ user: { ...state.user, name } });
  },
};

/* ── заказы ──────────────────────────────────────────────────────────────
   Раньше заказы писались прямо в браузер. Теперь источник истины — сервер:
   только он знает, оплачен заказ или нет. Здесь остаётся зеркало последних
   загруженных заказов, чтобы кабинет не мигал пустотой, пока идёт запрос.
   ────────────────────────────────────────────────────────────────────────── */

export const orders = {
  /** Кладём то, что вернул сервер. */
  cache(list) {
    store.set({ orders: Array.isArray(list) ? list : [] });
  },
  cached: () => state.orders,
  count: () => state.orders.length,
};

export const ORDER_STATUS = {
  created: { label: 'Создан', note: 'Платёж создан, ждём оплату.' },
  pending: { label: 'Ждёт оплаты', note: 'Ссылка на оплату выдана. Не тяни — тираж маленький.' },
  paid: { label: 'Оплачен', note: 'Деньги пришли. Собираем и пакуем в тёмный пакет.' },
  on_hold: { label: 'Деньги захолдированы', note: 'Платёж подтверждён, деньги зарезервированы.' },
  canceled: { label: 'Отменён', note: 'Платёж не состоялся. Вещь вернулась в тираж.' },
  refunded: { label: 'Возврат', note: 'Деньги вернулись тем же способом.' },
  partially_refunded: { label: 'Частичный возврат', note: 'Часть суммы вернулась.' },
  expired: { label: 'Истёк', note: 'Время оплаты вышло — заказ закрыт.' },
};

/* ── уведомления ───────────────────────────────────────────────────────── */

export const notif = {
  get: () => state.notif,
  togglePush() {
    const next = { ...state.notif, push: !state.notif.push };
    if (next.push && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    store.set({ notif: next });
    return next;
  },
  toggleEmail() {
    store.set({ notif: { ...state.notif, email: !state.notif.email } });
    return state.notif;
  },
  /**
   * Локальный «пуш» о дропе — тем же способом, что и настоящий: через
   * Notification API, если разрешили.
   */
  ping(title, body) {
    if (!state.notif.push || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
    try { new Notification(title, { body, silent: false }); return true; }
    catch { return false; }
  },
};

/* ── служебное ─────────────────────────────────────────────────────────── */

export function visitCount() {
  const n = safeStore.get(VISIT_KEY, 0) + 1;
  safeStore.set(VISIT_KEY, n);
  return n;
}

/** Сводка для кабинета и главной. */
export function summary() {
  const access = queue.access();
  const dropItems = productsOfDrop(CURRENT_DROP.id);
  return {
    access,
    position: queue.position(),
    queueSize: queue.size(),
    invites: queue.invites(),
    friends: state.queue?.friends || 0,
    cartCount: cart.count(),
    wishlistCount: wishlist.count(),
    ordersCount: state.orders.length,
    dropItems,
    dropLeft: dropItems.reduce((n, p) => n + totalStock(p), 0),
  };
}

export const ALL_PRODUCTS = PRODUCTS;
