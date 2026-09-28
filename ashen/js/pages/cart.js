/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — корзина
   Позиции, количество, итоги. Пусто — так и скажем.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  PRODUCTS, CURRENT_DROP, PAYMENTS, FREE_SHIPPING_FROM, productsOfDrop, productById,
} from '../data.js';
import { cart, wishlist, queue, store, lineKey } from '../store.js';
import { $, $$, el, esc, money, initReveal, pluralize } from '../util.js';
import { productGrid, toast } from '../ui.js';

export default async function cartPage() {
  const host = $('[data-cart-page]');
  const status = $('[data-cart-status]');
  const recs = $('[data-cart-recs]');
  if (!host) return;

  const paint = () => {
    const lines = cart.detailed();

    if (status) {
      status.className = `status${lines.length ? ' status--live' : ' status--out'}`;
      status.textContent = lines.length
        ? `${pluralize(cart.count(), ['позиция', 'позиции', 'позиций'])} · ${money(cart.subtotal())}`
        : 'пусто';
    }

    if (!lines.length) {
      host.className = '';
      host.innerHTML = `
        <div class="empty-state">
          <span class="status status--out">0 позиций</span>
          <p class="t-md display">Тут пусто. Как в твоём вишлисте.</p>
          <p class="body-muted measure-sm">
            Загляни в капсулу недели — дроп 07 закрывается, когда закончится тираж.
          </p>
          <div class="row row--wrap center" style="justify-content:center">
            <a class="btn btn--solid" href="catalog.html?drop=${esc(CURRENT_DROP.id)}">Смотреть дроп 07</a>
            <a class="link-underline" href="waitlist.html">Встать в очередь</a>
          </div>
        </div>`;
    } else {
      host.className = 'cart-layout';
      const sum = cart.subtotal();
      const shipping = sum >= FREE_SHIPPING_FROM ? 0 : 490;
      const discount = queue.access().key !== 'none' ? Math.round(sum * 0.05) : 0;
      const total = sum + shipping - discount;
      const access = queue.access();

      host.innerHTML = `
        <div class="stack stack--lg">
          <div class="stack">
            ${lines.map((l) => `
              <article class="line-item" data-key="${esc(l.key)}" style="grid-template-columns:96px 1fr auto">
                <a href="product.html?id=${esc(l.id)}">
                  <img class="line-item__img" src="assets/img/${esc(l.id)}.png" alt="${esc(l.product.name)}"
                       width="150" height="188" loading="lazy">
                </a>
                <div class="stack stack--sm">
                  <a class="line-item__name" href="product.html?id=${esc(l.id)}">${esc(l.product.name)}</a>
                  <span class="line-item__opt">
                    ${l.size ? `размер ${esc(l.size)}` : 'один размер'} · ${esc(l.product.color)}
                  </span>
                  <span class="field__hint">${esc(l.product.short || '')}</span>
                  <div class="line-item__ctrl">
                    <span class="qty">
                      <button type="button" data-q="-1" aria-label="Меньше">−</button>
                      <span>${l.qty}</span>
                      <button type="button" data-q="1" aria-label="Больше">+</button>
                    </span>
                    <button class="remove-x" type="button" data-remove>Убрать</button>
                    <button class="remove-x" type="button" data-wish>${wishlist.has(l.id) ? 'В вишлисте ✓' : 'В вишлист'}</button>
                  </div>
                </div>
                <div class="right stack stack--sm">
                  <span class="price">${money(l.sum)}</span>
                  ${l.qty > 1 ? `<span class="field__hint">${money(l.unit)} × ${l.qty}</span>` : ''}
                </div>
              </article>`).join('')}
          </div>

          <div class="row row--between row--wrap">
            <a class="link-underline" href="catalog.html">← Продолжить выбирать</a>
            <button class="remove-x" type="button" data-clear>Очистить корзину</button>
          </div>
        </div>

        <aside class="summary panel">
          <p class="mono-label mono-label--hot">Итого</p>
          <div class="summary-row"><span class="muted">Товары</span><span class="price">${money(sum)}</span></div>
          <div class="summary-row">
            <span class="muted">Доставка</span>
            <span class="price">${shipping === 0 ? 'бесплатно' : money(shipping)}</span>
          </div>
          ${discount ? `<div class="summary-row"><span class="hot">Скидка свои · 5%</span><span class="price hot">−${money(discount)}</span></div>` : ''}
          <div class="summary-row summary-row--total"><span>К оплате</span><span class="price">${money(total)}</span></div>
          ${shipping ? `<p class="field__hint">До бесплатной доставки — ${money(FREE_SHIPPING_FROM - sum)}.</p>` : ''}

          <a class="btn btn--solid btn--block btn--lg" href="checkout.html">Перейти к оплате</a>

          <div class="stack stack--sm" style="margin-top:.35rem">
            <p class="field__hint">Оплата: ${PAYMENTS.map((p) => esc(p.title)).join(' · ')}</p>
            <p class="field__hint">
              ${access.key === 'none'
                ? 'Ты не в очереди — оформим, но свои получают ранний доступ.'
                : `Класс доступа: ${esc(access.label)}. Ранний вход на ${access.lead} ч.`}
            </p>
          </div>
        </aside>`;

      host.querySelectorAll('.line-item').forEach((row) => {
        const key = row.dataset.key;
        const line = () => cart.items().find((l) => lineKey(l.id, l.size) === key);
        row.querySelector('[data-q="-1"]')?.addEventListener('click', () => cart.setQty(key, (line()?.qty || 1) - 1));
        row.querySelector('[data-q="1"]')?.addEventListener('click', () => cart.setQty(key, (line()?.qty || 0) + 1));
        row.querySelector('[data-remove]')?.addEventListener('click', () => {
          cart.remove(key);
          toast('Убрали', 'Вернуть можно из каталога — пока не распродали.', 2400);
        });
        row.querySelector('[data-wish]')?.addEventListener('click', (e) => {
          const on = wishlist.toggle(row.dataset.key.split('::')[0]);
          e.currentTarget.textContent = on ? 'В вишлисте ✓' : 'В вишлист';
        });
      });

      host.querySelector('[data-clear]')?.addEventListener('click', () => {
        cart.clear();
        toast('Корзина пуста', 'Тут пусто. Как в твоём вишлисте.', 3000);
      });
    }

    /* рекомендации */
    if (recs) {
      recs.innerHTML = '';
      const inCart = new Set(cart.items().map((l) => l.id));
      const pool = [
        ...productsOfDrop(CURRENT_DROP.id),
        ...wishlist.products(),
        ...PRODUCTS.filter((p) => p.hero),
      ].filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i && !inCart.has(p.id));
      if (pool.length) {
        recs.closest('[data-cart-recs-block]')?.removeAttribute('hidden');
        recs.append(productGrid(pool.slice(0, 4)));
      }
    }
  };

  paint();
  store.on(paint);
  initReveal();
}
