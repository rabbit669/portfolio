/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — оплата
   Браузер собирает заказ и уходит на форму провайдера. Данные карты мы не
   видим и не храним: их вводит покупатель на стороне ЮKassa, а обратно
   приходит только статус.

   Поэтому полей карты на этой странице нет — и это правильно.
   ═══════════════════════════════════════════════════════════════════════════ */

import { CURRENT_DROP } from '../data.js';
import { cart, user, queue } from '../store.js';
import { $, esc, money, sleep, initReveal } from '../util.js';
import { toast } from '../ui.js';
import {
  loadPaymentConfig, createPayment, goToPayment, newIdempotenceKey, modeBadge, joinQueue, IS_STATIC,
} from '../payments.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (v) => v.replace(/\D/g, '');

const fmtPhone = (v) => {
  const d = digits(v).slice(0, 11);
  if (!d) return '';
  const p = d.startsWith('8') ? '7' + d.slice(1) : d;
  const b = p.slice(1, 4), c = p.slice(4, 7), e = p.slice(7, 9), f = p.slice(9, 11);
  let out = '+7';
  if (b) out += ` (${b}`;
  if (b.length === 3) out += ')';
  if (c) out += ` ${c}`;
  if (e) out += `-${e}`;
  if (f) out += `-${f}`;
  return out;
};

const ICONS = {
  card: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" style="vertical-align:-3px"><rect x="3" y="6" width="18" height="12"/><path d="M3 10h18"/></svg>',
  sbp: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" style="vertical-align:-3px"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3z"/></svg>',
  split: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" style="vertical-align:-3px"><path d="M4 12h16M12 4v16"/><circle cx="12" cy="12" r="8"/></svg>',
};

export default async function checkout() {
  const host = $('[data-checkout]');
  if (!host) return;

  const savedUser = user.get();
  const cartEmpty = !cart.detailed().length;

  /* ── настройки кассы спрашиваем у сервера ── */
  const config = await loadPaymentConfig();

  if (!config) {
    host.innerHTML = `
      <div class="panel panel--violet" style="display:grid;gap:1rem">
        <span class="status status--out">сервер оплаты не отвечает</span>
        <p class="t-sm display">ЗАПУСТИ СЕРВЕР, ИНАЧЕ ОПЛАТИТЬ НЕЛЬЗЯ</p>
        <p class="body-muted measure">
          Платёж создаётся на сервере — иначе секретный ключ пришлось бы держать
          в браузере, а так делать нельзя.
        </p>
        <pre class="panel" style="overflow-x:auto;padding:.85rem 1rem;margin:0"><code>node server/server.mjs</code></pre>
        <div class="row row--wrap">
          <button class="btn btn--sm" type="button" data-retry>Проверить снова</button>
          <a class="link-underline" href="cart.html">← В корзину</a>
        </div>
      </div>`;
    $('[data-retry]', host)?.addEventListener('click', () => location.reload());
    return;
  }

  const badge = modeBadge(config);
  const isStatic = IS_STATIC || !!config.static;
  const deliveries = config.delivery;
  let deliveryId = deliveries.find((d) => d.id === 'courier')?.id || deliveries[0]?.id;
  let methodId = config.methods[0]?.id || 'card';

  /* ── суммы показываем сами, но итог всё равно назначит сервер ── */
  const totals = () => {
    const sum = cart.subtotal();
    const delivery = deliveries.find((d) => d.id === deliveryId) || deliveries[0];
    const shipping = sum >= Number(config.freeShippingFrom) ? 0 : Number(delivery?.price || 0);
    const member = !!queue.entry();
    const discount = member ? Math.round((sum * config.memberDiscountPercent) / 100) : 0;
    return { sum, delivery, shipping, discount, member, total: sum + shipping - discount };
  };

  /* ── разметка ── */
  host.innerHTML = `
    <div class="cart-layout">
      <form class="pay-form" data-form novalidate>

        ${isStatic ? `
        <div class="panel" style="border-color:var(--violet-deep)">
          <p class="mono-label mono-label--hot">Демонстрационная сборка</p>
          <p class="body-muted" style="font-size:var(--step--1);margin-top:.5rem">
            Это витрина портфолио, сервер оплаты здесь не запущен. Каталог, корзина, кабинет
            и комьюнити работают полностью, а платёж создать нельзя — он создаётся на сервере,
            иначе секретный ключ платёжной системы пришлось бы держать в браузере.
          </p>
          <p class="field__hint" style="margin-top:.6rem">
            Чтобы пройти оплату целиком, проект запускают локально:
            <code>node server/server.mjs</code>
          </p>
          <a class="btn btn--sm" href="catalog.html?drop=${esc(CURRENT_DROP.id)}" style="margin-top:.75rem">В каталог</a>
        </div>` : ''}

        ${cartEmpty && !isStatic ? `
        <div class="panel" style="border-color:var(--violet-deep)">
          <p class="mono-label mono-label--hot">Корзина пуста</p>
          <p class="body-muted" style="font-size:var(--step--1);margin-top:.5rem">
            Система не берёт деньги за пустоту. Выбери вещь — и кнопка оживёт.
          </p>
          <a class="btn btn--sm" href="catalog.html?drop=${esc(CURRENT_DROP.id)}" style="margin-top:.75rem">В каталог</a>
        </div>` : ''}

        <fieldset class="panel" style="border:1px solid var(--ash-line)">
          <legend class="mono-label mono-label--hot" style="padding:0 .5rem">01 · Контакт</legend>
          <div class="stack" style="margin-top:1rem">
            <div class="grid cols-2">
              <label class="field">
                <span class="field__label">Почта *</span>
                <input class="input" type="email" name="email" placeholder="you@mail.ru" autocomplete="email"
                       value="${esc(savedUser?.email || '')}" required>
                <span class="field__hint">На неё придёт чек.</span>
              </label>
              <label class="field">
                <span class="field__label">Имя</span>
                <input class="input" type="text" name="name" placeholder="как обращаться" autocomplete="given-name"
                       value="${esc(savedUser?.name || '')}">
              </label>
            </div>
            <label class="field">
              <span class="field__label">Телефон *</span>
              <input class="input" type="tel" name="phone" placeholder="+7 (999) 000-00-00" autocomplete="tel" inputmode="tel" required>
              <span class="field__hint">Только для курьера и для чека. В рекламу не уходит.</span>
            </label>
          </div>
        </fieldset>

        <fieldset class="panel" style="border:1px solid var(--ash-line)">
          <legend class="mono-label mono-label--hot" style="padding:0 .5rem">02 · Доставка</legend>
          <div class="radio-row" style="margin-top:1rem" data-delivery>
            ${deliveries.map((d) => `
              <label class="pay-opt">
                <input type="radio" name="delivery" value="${esc(d.id)}" ${d.id === deliveryId ? 'checked' : ''}>
                <span class="pay-opt__title">${esc(d.title)}</span>
                <span class="pay-opt__note">${esc(d.note)} · ${esc(d.eta)}</span>
              </label>`).join('')}
          </div>
          <label class="field" style="margin-top:1rem" data-address-field>
            <span class="field__label">Адрес *</span>
            <input class="input" type="text" name="address" placeholder="улица, дом, квартира" autocomplete="street-address">
            <span class="field__hint" data-delivery-hint></span>
          </label>
        </fieldset>

        <fieldset class="panel" style="border:1px solid var(--ash-line)">
          <legend class="mono-label mono-label--hot" style="padding:0 .5rem">03 · Оплата</legend>
          <div class="radio-row" style="margin-top:1rem" data-payments>
            ${config.methods.map((m) => `
              <label class="pay-opt">
                <input type="radio" name="method" value="${esc(m.id)}" ${m.id === methodId ? 'checked' : ''}>
                <span class="pay-opt__title">${ICONS[m.id] || ''} ${esc(m.title)}</span>
                <span class="pay-opt__note">${esc(m.note)}</span>
              </label>`).join('')}
          </div>
          <p class="field__hint" style="margin-top:1rem" data-pay-note></p>
        </fieldset>

        <label class="switch">
          <input type="checkbox" name="terms" checked>
          <span class="switch__track" aria-hidden="true"></span>
          <span>Согласен с <a class="link-underline" href="offer.html" target="_blank" rel="noopener">офертой</a>
          и <a class="link-underline" href="privacy.html" target="_blank" rel="noopener">политикой данных</a></span>
        </label>

        <div class="stack stack--sm">
          <button class="btn btn--solid btn--block btn--lg" type="submit" data-place-order
                  ${isStatic || cartEmpty ? 'disabled' : ''}>
            ${isStatic ? 'Оплата недоступна в демо-сборке' : cartEmpty ? 'Корзина пуста' : 'Перейти к оплате'}
          </button>
          <p class="field__hint" data-mode-note>
            ${esc(badge.text)}${config.live ? '' : '. Деньги не списываются.'}
          </p>
          <p class="field__error" data-error hidden></p>
        </div>
      </form>

      <aside class="summary panel">
        <p class="mono-label mono-label--hot">Заказ</p>
        <div class="stack" data-summary-items></div>
        <div style="border-top:1px solid var(--ash-line);padding-top:.85rem" class="stack stack--sm" data-summary-totals></div>
        <p class="field__hint" data-summary-access></p>
      </aside>
    </div>`;

  const form = $('[data-form]', host);
  const errBox = $('[data-error]', host);
  const place = $('[data-place-order]', host);

  if (cartEmpty || isStatic) {
    place.disabled = true;
    place.addEventListener('click', (e) => e.preventDefault());
  }

  /* ── переключение доставки и способа оплаты ── */
  $('[data-delivery]', host).addEventListener('change', (e) => {
    deliveryId = e.target.value;
    drawTotals();
  });
  $('[data-payments]', host).addEventListener('change', (e) => {
    methodId = e.target.value;
    drawTotals();
  });

  form.elements.phone.addEventListener('input', (e) => { e.target.value = fmtPhone(e.target.value); });
  form.elements.email.addEventListener('input', (e) => e.target.classList.remove('is-bad'));

  /* ── итоги ── */
  function drawTotals() {
    const { sum, delivery, shipping, discount, member, total } = totals();

    $('[data-summary-items]', host).innerHTML = cart.detailed().map((l) => `
      <div class="row row--between" style="align-items:flex-start">
        <span style="font-size:var(--step--1)">
          ${esc(l.product.name)}${l.size ? ` · ${esc(l.size)}` : ''}
          <span class="muted">× ${l.qty}</span>
        </span>
        <span class="price" style="font-size:var(--step--1)">${money(l.sum)}</span>
      </div>`).join('') || '<span class="muted" style="font-size:var(--step--1)">Пусто</span>';

    $('[data-summary-totals]', host).innerHTML = `
      <div class="summary-row"><span class="muted">Товары</span><span class="price">${money(sum)}</span></div>
      <div class="summary-row"><span class="muted">${esc(delivery?.title || '')}</span><span class="price">${shipping === 0 ? 'бесплатно' : money(shipping)}</span></div>
      ${discount ? `<div class="summary-row"><span class="hot">Скидка свои · ${config.memberDiscountPercent}%</span><span class="price hot">−${money(discount)}</span></div>` : ''}
      <div class="summary-row summary-row--total"><span>К оплате</span><span class="price">${money(total)}</span></div>`;

    $('[data-summary-access]', host).textContent = isStatic
      ? 'Демо-сборка портфолио: суммы считаются, платёж не создаётся.'
      : member
        ? `Ты в очереди — скидка ${config.memberDiscountPercent}% применена.`
        : 'Ты не в очереди. Встань — свои получают скидку и ранний доступ.';

    const hint = $('[data-delivery-hint]', host);
    if (hint) {
      hint.textContent = deliveryId === 'pickup'
        ? 'Точка выдачи: Москва, Нижняя Сыромятническая, 11.'
        : deliveryId === 'courier'
          ? 'Курьер привезёт в тёмном пакете. Без логотипов на упаковке.'
          : 'Пункт СДЭК выберешь в письме. Трек придёт на почту.';
    }
    $('[data-address-field]', host).style.display = deliveryId === 'pickup' ? 'none' : '';

    const notes = {
      card: isStatic
        ? 'В рабочей сборке карту покупатель вводит на защищённой странице ЮKassa. Мы её не видим.'
        : 'Карту вводишь на защищённой странице ЮKassa. Мы её не видим и не храним.',
      sbp: 'Отсканируешь QR в приложении банка. Без комиссии.',
      split: '«Долями» — 4 платежа по 25%, без процентов. Одобрение обычно за пару минут.',
    };
    $('[data-pay-note]', host).textContent = notes[methodId] || '';
  }

  drawTotals();

  /* ── отправка: платёж создаёт сервер ── */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;

    const email = form.elements.email.value.trim();
    const phone = digits(form.elements.phone.value);
    const terms = form.elements.terms.checked;
    const address = form.elements.address.value.trim();

    const fail = (msg, node) => {
      errBox.hidden = false;
      errBox.textContent = msg;
      node?.classList.add('is-bad');
      node?.focus();
      toast('Не прошло', msg, 4200);
    };

    if (!EMAIL_RE.test(email)) return fail('Почта не похожа на почту. Чек должен дойти.', form.elements.email);
    if (phone.length < 11) return fail('Телефон нужен целиком — курьеру звонить.', form.elements.phone);
    if (deliveryId !== 'pickup' && !address) return fail('Куда везти? Без адреса не соберём заказ.', form.elements.address);
    if (!terms) return fail('Без согласия с условиями оформить нельзя.', form.elements.terms);

    place.disabled = true;
    place.innerHTML = '<span class="spinner"></span> Создаём платёж…';

    /* Ключ идемпотентности живёт в замыкании: повторная отправка формы
       (двойной клик или ретрай после таймаута) не создаст второй платёж. */
    if (!form.dataset.idemKey) form.dataset.idemKey = newIdempotenceKey();

    try {
      const { order, confirmationUrl } = await createPayment({
        items: cart.items().map((l) => ({ id: l.id, size: l.size, qty: l.qty })),
        method: methodId,
        deliveryId,
        contact: { email, name: form.elements.name.value.trim(), phone: form.elements.phone.value },
        address,
      }, { idempotencyKey: form.dataset.idemKey });

      // очередь на сервере влияет на скидку в следующих заказах
      if (!queue.entry()) {
        joinQueue(email, form.elements.name.value.trim()).catch(() => {});
      }

      if (!goToPayment(confirmationUrl)) {
        throw new Error('Провайдер не выдал ссылку на оплату');
      }

      place.innerHTML = `<span class="spinner"></span> Переходим на оплату · ${esc(order.number)}`;
    } catch (err) {
      place.disabled = false;
      place.textContent = 'Перейти к оплате';
      // ключ сбрасываем: следующая попытка — это уже другой платёж
      delete form.dataset.idemKey;

      const detail = err.details?.description || err.details?.code;
      fail(
        err.status === 409 ? err.message
          : err.status === 429 ? 'Слишком часто. Подожди минуту.'
            : err.status === 0 ? 'Сервер оплаты не отвечает. Запусти node server/server.mjs'
              : detail ? `${err.message}: ${detail}` : err.message,
        null,
      );
      return;
    }

    await sleep(300);
  });

  initReveal();
}
