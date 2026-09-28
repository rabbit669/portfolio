/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — платёжный слой в браузере
   Браузер больше не «оплачивает» сам. Он просит сервер создать платёж,
   получает ссылку на форму провайдера и уходит туда.

   Секретный ключ ЮKassa сюда не попадает никогда — его здесь просто нет.
   ═══════════════════════════════════════════════════════════════════════════ */

import { safeStore } from './util.js';

const API = '/api';

/** Ключ идемпотентности: одна попытка оплаты = один платёж. */
export function newIdempotenceKey() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, 'Сервер не отвечает. Проверь, запущен ли node server/server.mjs', {
      cause: String(err?.message || err),
    });
  }

  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }

  if (!res.ok) {
    throw new ApiError(res.status, payload?.error || `Ошибка ${res.status}`, payload?.details || null);
  }
  return payload;
}

/* ── публичный интерфейс ───────────────────────────────────────────────── */

let configCache = null;

/**
 * Статическая сборка: страницы лежат на хостинге без сервера.
 * Определяем по атрибуту на <html> — его ставит сборщик портфолио.
 * В этом режиме в API не стучимся вообще: иначе в консоли будет 404,
 * а покупатель увидит «сервер не отвечает» вместо внятного объяснения.
 */
export const IS_STATIC = document.documentElement.dataset.ashen === 'static';

/**
 * Готовые настройки для статической сборки: способы оплаты и доставка
 * совпадают с серверными, но оплата выключена осознанно — она требует
 * сервера, иначе секретный ключ пришлось бы держать в браузере.
 */
export const STATIC_CONFIG = {
  mode: 'static',
  live: false,
  demo: true,
  static: true,
  currency: 'RUB',
  methods: [
    { id: 'card', title: 'Карта', note: 'Visa, Mastercard, МИР', installments: false },
    { id: 'sbp', title: 'СБП', note: 'По QR, без комиссии', installments: false },
    { id: 'split', title: 'Рассрочка', note: '4 платежа по 25%, без процентов', installments: true, parts: 4 },
  ],
  delivery: [
    { id: 'pickup', title: 'Самовывоз', note: 'Москва, точка выдачи', price: '0.00', eta: '1–2 дня' },
    { id: 'courier', title: 'Курьер по Москве', note: 'До двери, тёмный пакет', price: '490.00', eta: 'завтра' },
    { id: 'cdek', title: 'СДЭК до пункта', note: 'Вся Россия', price: '590.00', eta: '3–5 дней' },
  ],
  freeShippingFrom: '25000.00',
  memberDiscountPercent: 5,
  receiptEnabled: false,
  demoNotice: 'Демонстрационная сборка: оплата работает только на сервере. '
    + 'Так сделано специально — платёж создаётся на сервере, иначе секретный ключ '
    + 'платёжной системы оказался бы в браузере, где его увидит любой.',
};

/**
 * Настройки магазина: с сервера или из статической сборки.
 * Возвращаем null только если сервер должен быть, но не отвечает.
 */
export async function loadPaymentConfig({ force = false } = {}) {
  if (IS_STATIC) return STATIC_CONFIG;
  if (configCache && !force) return configCache;
  try {
    const data = await request('/config');
    configCache = data.config;
    return configCache;
  } catch {
    return null;
  }
}

export function cachedConfig() {
  return configCache;
}

/**
 * Создать платёж и получить ссылку на форму оплаты.
 * @returns {Promise<{order: object, confirmationUrl: string|null, replayed: boolean}>}
 */
export async function createPayment(payload, { idempotenceKey } = {}) {
  const key = idempotenceKey || newIdempotenceKey();
  const data = await request('/payments', {
    method: 'POST',
    body: payload,
    headers: { 'Idempotence-Key': key },
  });
  /* Запоминаем два разных ключа:
     key   — ключ идемпотентности, чтобы не создать второй платёж;
     token — идентификатор платежа, он же доказательство владения заказом.
     Второй нужен кабинету: по нему сервер отдаёт заказы владельцу. */
  safeStore.set('ashen.lastPayment', {
    key,
    token: data.order.payment?.id || null,
    orderId: data.order.id,
    number: data.order.number,
    at: Date.now(),
  });
  return { order: data.order, confirmationUrl: data.order.payment?.confirmationUrl || null, replayed: !!data.replayed };
}

/** Свежий статус заказа, синхронизированный с провайдером. */
export async function syncOrder(orderId) {
  const data = await request(`/orders/${encodeURIComponent(orderId)}/sync`, { method: 'POST' });
  return data.order;
}

export async function getOrder(idOrNumber) {
  const data = await request(`/orders/${encodeURIComponent(idOrNumber)}`);
  return data.order;
}

/**
 * Заказы покупателя.
 * Токен владения (id последнего платежа) даёт полный список; без него сервер
 * попросит номер заказа. Это защита от перебора по чужой почте.
 */
export async function listOrders(email, { code = '', token = null } = {}) {
  const q = new URLSearchParams({ email });
  const t = token ?? lastPayment()?.token;
  if (t) q.set('token', t);
  if (code) q.set('code', code);
  return request(`/orders?${q}`);
}

/** Встать в очередь на сервере — от неё зависит скидка «своих». */
export async function joinQueue(email, name = '') {
  return request('/waitlist', { method: 'POST', body: { email, name } });
}

/** Демо-оплата: только в режиме demo, заменяет страницу провайдера. */
export async function confirmDemoPayment(paymentId, outcome = 'succeed') {
  return request('/demo/pay', { method: 'POST', body: { paymentId, outcome } });
}

export function lastPayment() {
  return safeStore.get('ashen.lastPayment', null);
}

/* ── переход на форму оплаты ───────────────────────────────────────────── */

/**
 * Уходим на оплату. Если ссылки нет — значит провайдер не дал редирект,
 * и это надо показать человеку, а не молча оставить его на месте.
 */
export function goToPayment(confirmationUrl) {
  if (!confirmationUrl) return false;
  window.location.assign(confirmationUrl);
  return true;
}

/** Подпись о режиме работы: в демо покупатель обязан это видеть. */
export function modeBadge(config) {
  if (!config) return { text: 'Сервер оплаты недоступен', tone: 'bad' };
  if (config.live) return { text: 'Оплата через ЮKassa', tone: 'ok' };
  return { text: 'Демо-режим: деньги не списываются', tone: 'demo' };
}
