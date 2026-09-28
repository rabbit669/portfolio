/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — страница возврата с оплаты
   Сюда покупателя приводит провайдер (или демо-шлюз). Наша задача — узнать
   настоящий статус, а не поверить параметрам в адресной строке.

   Правило: ни одному параметру URL не верим. Статус берём только у сервера,
   а сервер — у ЮKassa.
   ═══════════════════════════════════════════════════════════════════════════ */

import { cart, user, queue } from '../store.js';
import { $, esc, money, initReveal, qsParam, sleep, pluralize } from '../util.js';
import { toast } from '../ui.js';
import {
  loadPaymentConfig, syncOrder, getOrder, confirmDemoPayment, lastPayment, goToPayment,
} from '../payments.js';

const nf = new Intl.NumberFormat('ru-RU');

/** Заказ, который сейчас проверяем: из адреса или из памяти браузера. */
function pendingOrderId() {
  const fromUrl = qsParam('order');
  if (fromUrl) return fromUrl;
  return lastPayment()?.orderId || null;
}

export default async function paymentPage() {
  const host = $('[data-payment-status]');
  if (!host) return;

  const config = await loadPaymentConfig();
  const demoPaymentId = qsParam('demo_payment');

  /* ── демо-шлюз: показываем «страницу оплаты» вместо провайдера ── */
  if (demoPaymentId) {
    await renderDemoCheckout(demoPaymentId);
    initReveal();
    return;
  }

  const orderId = pendingOrderId();
  if (!orderId) {
    renderNothing();
    initReveal();
    return;
  }

  /* ── обычный возврат с оплаты ── */
  host.innerHTML = loading('Спрашиваем у банка, прошёл ли платёж…');

  let order = null;
  let error = null;
  try {
    // сервер сам сходит в ЮKassa и вернёт свежий статус
    order = await syncOrder(orderId);
  } catch (err) {
    error = err;
    try { order = await getOrder(orderId); } catch { /* совсем не достали */ }
  }

  if (!order) {
    renderProblem('Не нашли заказ', error?.message || 'Проверь, что сервер оплаты запущен.');
    initReveal();
    return;
  }

  renderResult(order, { live: !!config?.live, syncFailed: !!error });
  initReveal();

  /* ── пока платёж в процессе — подтягиваем статус сам ── */
  if (order.status === 'pending' || order.status === 'created') {
    poll(order.id, 8);
  }

  /* ── демо-страница оплаты ────────────────────────────────────────────── */
  async function renderDemoCheckout(paymentId) {
    host.innerHTML = `
      <div class="panel" style="border-color:var(--violet-deep);display:grid;gap:1rem">
        <p class="mono-label mono-label--hot">Демо-оплата</p>
        <h1 class="t-sm display">ЗДЕСЬ БЫЛА БЫ ФОРМА ЮKASSA</h1>
        <p class="body-muted measure">
          В live-режиме покупатель уходит на страницу ЮKassa и вводит карту там —
          мы её никогда не видим. Сейчас ключей нет, поэтому решение принимаешь ты.
        </p>
        <div class="row row--wrap">
          <button class="btn btn--solid" type="button" data-demo="succeed">Оплатить</button>
          <button class="btn btn--violet" type="button" data-demo="cancel">Отменить</button>
          <button class="btn btn--ghost" type="button" data-demo="expire">Пусть истечёт</button>
        </div>
        <p class="field__hint">Идентификатор демо-платежа: <span class="muted">${esc(paymentId)}</span></p>
      </div>`;

    host.querySelectorAll('[data-demo]').forEach((btn) => btn.addEventListener('click', async () => {
      const outcome = btn.dataset.demo;
      host.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        await confirmDemoPayment(paymentId, outcome);
      } catch (err) {
        toast('Не получилось', err.message, 4000);
      }
      const id = pendingOrderId();
      if (!id) { renderNothing(); return; }
      const fresh = await syncOrder(id).catch(() => null);
      if (fresh) {
        renderResult(fresh, { live: false });
        initReveal();
      } else {
        renderProblem('Статус не читается', 'Сервер не отдал заказ. Проверь логи.');
      }
    }));
  }

  /* ── опрос статуса ───────────────────────────────────────────────────── */
  async function poll(id, attempts) {
    for (let i = 0; i < attempts; i++) {
      await sleep(3000);
      let fresh = null;
      try { fresh = await syncOrder(id); } catch { continue; }
      if (!fresh) continue;
      if (fresh.status !== 'pending' && fresh.status !== 'created') {
        renderResult(fresh, { live: !!config?.live });
        initReveal();
        return;
      }
      const note = $('[data-poll-note]');
      if (note) note.textContent = `Проверяем ещё раз… (${i + 1}/${attempts})`;
    }
  }

  /* ── состояния экрана ────────────────────────────────────────────────── */

  function loading(text) {
    return `
      <div class="panel" style="display:grid;gap:.85rem;justify-items:start">
        <span class="status status--live">проверка</span>
        <p class="t-xs display">${esc(text)}</p>
        <span class="spinner"></span>
      </div>`;
  }

  function renderNothing() {
    host.innerHTML = `
      <div class="empty-state">
        <span class="status status--out">нечего проверять</span>
        <p class="t-sm display">Платёж не найден.</p>
        <p class="body-muted measure-sm">Возможно, ты открыл эту страницу напрямую. Начни с корзины.</p>
        <div class="row row--wrap" style="justify-content:center">
          <a class="btn btn--solid" href="catalog.html">В каталог</a>
          <a class="link-underline" href="cart.html">В корзину</a>
        </div>
      </div>`;
  }

  function renderProblem(title, note) {
    host.innerHTML = `
      <div class="panel panel--violet" style="display:grid;gap:.85rem">
        <span class="status status--out">сбой</span>
        <p class="t-sm display">${esc(title)}</p>
        <p class="body-muted">${esc(note || '')}</p>
        <div class="row row--wrap">
          <button class="btn btn--sm" type="button" data-retry>Проверить ещё раз</button>
          <a class="link-underline" href="account.html#orders">Мои заказы</a>
        </div>
      </div>`;
    $('[data-retry]', host)?.addEventListener('click', () => location.reload());
  }

  /** Главный экран: ACCESS GRANTED, либо ожидание, либо отказ. */
  function renderResult(order, { live, syncFailed = false }) {
    const total = `${nf.format(Math.round(Number(order.total)))} ₽`;
    const items = order.items || [];
    const qty = items.reduce((n, i) => n + i.qty, 0);

    /* — оплачено — */
    if (order.status === 'paid') {
      // корзина больше не нужна: заказ на сервере
      cart.clear();
      if (!queue.entry() && order.contact?.email) queue.join({ email: order.contact.email });

      host.innerHTML = `
        <div class="granted" data-granted>
          <p class="mono-label mono-label--hot">Оплата прошла</p>
          <p class="access-granted t-lg">ACCESS<br>GRANTED</p>
          <p class="body-muted measure-sm">
            Заказ ${esc(order.number)} принят. Упакуем в тёмный пакет и отправим.
            ${Number(order.discount) ? `Скидка своих — ${money(order.discount)}.` : ''}
          </p>

          <div class="granted__grid">
            <div class="stat"><span class="stat__val">${money(order.total)}</span><span class="stat__label">оплачено · ${esc(order.methodTitle)}</span></div>
            <div class="stat"><span class="stat__val">${esc(order.deliveryTitle)}</span><span class="stat__label">доставка</span></div>
            <div class="stat"><span class="stat__val">${qty}</span><span class="stat__label">${pluralize(qty, ['вещь', 'вещи', 'вещей'])} в заказе</span></div>
          </div>

          <p class="mono-label">Номер заказа · ${esc(order.number)}</p>

          <div class="stack" style="width:100%;text-align:left;border-top:1px solid var(--ash-line);padding-top:1rem">
            ${items.map((i) => `
              <div class="order-line">
                <img src="${esc(i.img)}" alt="" width="54" height="68" loading="lazy">
                <span class="line-item__name">${esc(i.name)}${i.size ? ` · ${esc(i.size)}` : ''}</span>
                <span class="price" style="font-size:var(--step--1)">${money(i.sum)}</span>
              </div>`).join('')}
          </div>

          ${order.payment?.receiptRegistration ? `
            <p class="field__hint">
              ${order.payment.receiptRegistration === 'succeeded'
                ? 'Чек зарегистрирован и отправлен на почту.'
                : 'Чек регистрируется — придёт на почту следом.'}
            </p>` : ''}

          <div class="row row--wrap" style="justify-content:center">
            <a class="btn btn--solid" href="account.html#orders">Смотреть заказ</a>
            <button class="btn btn--violet" type="button" data-share>Поделиться ACCESS GRANTED</button>
            <a class="link-underline" href="community.html">Зайти в комьюнити</a>
          </div>
        </div>`;

      $('[data-share]', host)?.addEventListener('click', async () => {
        const text = `Оформил ${order.number} в ASHEN. ${total}.`;
        try {
          if (navigator.share) await navigator.share({ title: 'ASHEN', text });
          else { await navigator.clipboard.writeText(text); toast('Скопировано', 'Вставь в телегу.', 2600); }
        } catch { /* отменили */ }
      });
      return;
    }

    /* — деньги в холде — */
    if (order.status === 'on_hold') {
      host.innerHTML = `
        <div class="panel panel--violet" style="display:grid;gap:1rem">
          <span class="status status--soon">деньги захолдированы</span>
          <p class="t-sm display">ПЛАТЁЖ ПОДТВЕРЖДЁН, ДЕНЬГИ ЗАРЕЗЕРВИРОВАНЫ</p>
          <p class="body-muted measure">
            Банк держит сумму, но ещё не списал. Мы подтвердим платёж и спишем — обычно это занимает минуты.
            Заказ ${esc(order.number)} уже за тобой.
          </p>
          <div class="row row--wrap">
            <button class="btn btn--sm" type="button" data-retry>Обновить статус</button>
            <a class="link-underline" href="account.html#orders">Мои заказы</a>
          </div>
        </div>`;
      $('[data-retry]', host)?.addEventListener('click', () => location.reload());
      return;
    }

    /* — отменён / истёк — */
    if (order.status === 'canceled' || order.status === 'expired') {
      host.innerHTML = `
        <div class="panel" style="display:grid;gap:1rem">
          <span class="status status--out">${order.status === 'expired' ? 'истёк' : 'отменён'}</span>
          <p class="t-sm display">ОПЛАТА НЕ ПРОШЛА</p>
          <p class="body-muted measure">
            ${esc(order.statusNote || 'Платёж не состоялся.')}
            Деньги не списаны. Вещь вернулась в тираж — но тираж маленький, так что не тяни.
          </p>
          <div class="row row--wrap">
            <a class="btn btn--solid" href="checkout.html">Попробовать снова</a>
            <a class="link-underline" href="catalog.html?drop=drop-07">Вернуться в дроп</a>
          </div>
        </div>`;
      return;
    }

    /* — ждёт оплаты — */
    host.innerHTML = `
      <div class="panel" style="display:grid;gap:1rem">
        <span class="status status--live">ждём оплату</span>
        <p class="t-sm display">ЗАКАЗ ${esc(order.number)} СОЗДАН, НО НЕ ОПЛАЧЕН</p>
        <p class="body-muted measure">
          ${live
            ? 'Платёж создан в ЮKassa. Если ты не завершил оплату — вернись на форму.'
            : 'Демо-платёж создан. Оплату можно подтвердить на странице оплаты.'}
        </p>
        <p class="field__hint" data-poll-note>Проверяем статус автоматически…</p>
        <div class="row row--wrap">
          ${order.payment?.confirmationUrl ? '<button class="btn btn--solid" type="button" data-pay-again>Перейти к оплате</button>' : ''}
          <button class="btn btn--violet btn--sm" type="button" data-retry>Обновить статус</button>
          <a class="link-underline" href="account.html#orders">Мои заказы</a>
        </div>
        ${syncFailed ? '<p class="field__error">Связь с провайдером сейчас недоступна — показываем последний известный статус.</p>' : ''}
      </div>`;

    $('[data-pay-again]', host)?.addEventListener('click', () => {
      if (!goToPayment(order.payment.confirmationUrl)) toast('Ссылка не пришла', 'Обнови страницу.', 3000);
    });
    $('[data-retry]', host)?.addEventListener('click', () => location.reload());
  }
}

/* Если пользователь зашёл на страницу без заказа, но с почтой в кабинете,
   ничего не выдумываем: честно говорим, что проверять нечего. */
void user;
