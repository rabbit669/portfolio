/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — страница товара
   Название, цена, одна строка описания, размеры, кнопка, детали, из дропа, UGC.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  PRODUCTS, UGC, productById, dropById, productsOfDrop,
  productState, PRODUCT_STATE_LABEL, totalStock, SIZE_ORDER, PAYMENTS, FREE_SHIPPING_FROM,
} from '../data.js';
import { cart, wishlist, waitlist, queue, store } from '../store.js';
import { $, $$, el, esc, money, qsParam, initReveal } from '../util.js';
import {
  productGrid, detailsAccordion, ugcRail, toast, mountCountdown, addToCart, lineKey,
} from '../ui.js';

export default async function productPage() {
  const id = qsParam('id') || PRODUCTS.find((p) => productState(p) === 'live')?.id;
  const product = productById(id);
  const host = $('[data-product]');

  if (!product) {
    if (host) {
      host.innerHTML = `
        <div class="empty-state">
          <span class="status status--out">404</span>
          <p class="t-sm display">Такой вещи в системе нет.</p>
          <p class="body-muted measure-sm">Возможно, дроп распродан и страница закрыта. Такое бывает.</p>
          <a class="btn btn--sm" href="catalog.html">В каталог</a>
        </div>`;
    }
    return;
  }

  const drop = dropById(product.drop);
  const state = productState(product);
  document.title = `${product.name} — ASHEN`;

  const sizes = SIZE_ORDER.filter((s) => product.sizes && s in product.sizes);
  let chosen = null;
  const available = sizes.filter((s) => product.sizes[s] > 0);
  if (available.length === 1) chosen = available[0];

  /* ── разметка ── */
  host.className = 'product-page';
  host.innerHTML = `
    <div class="product-gallery">
      <figure class="product-gallery__main">
        <img src="assets/img/${esc(product.id)}.png" alt="${esc(product.name)}" width="800" height="1000"
             data-main-img>
        <div class="product__flag ${state === 'live' ? 'product__flag--violet' : ''}"
             style="position:absolute;top:.9rem;left:.9rem">${esc(PRODUCT_STATE_LABEL[state])}</div>
      </figure>
      <div class="product-gallery__thumbs">
        <img src="assets/img/${esc(product.id)}.png" alt="Кадр 1" loading="lazy" data-thumb>
        <img src="${esc(drop.cover)}" alt="Лукбук дропа" loading="lazy" data-thumb>
        <img src="${esc(UGC[(product.name.length + product.price) % UGC.length].img)}" alt="На покупателе" loading="lazy" data-thumb>
      </div>
    </div>

    <div class="product-info">
      <div class="stack stack--sm">
        <a class="product__drop" href="catalog.html?drop=${esc(product.drop)}">
          ${esc(drop.label)} · ${esc(drop.code)} · ${esc(product.kind)}
        </a>
        <h1 class="product-title">${esc(product.name)}</h1>
        <div class="price-row">
          <span class="price">${money(product.price)}</span>
          ${product.oldPrice ? `<span class="price price--strike">${money(product.oldPrice)}</span>` : ''}
          ${product.oldPrice ? `<span class="tag tag--hot">выгоднее на ${money(product.oldPrice - product.price)}</span>` : ''}
        </div>
      </div>

      <p class="product-quote">${esc(product.desc)}</p>

      <div data-buy-zone></div>

      <div class="stack stack--sm" data-delivery-note>
        <p class="field__hint">Бесплатная доставка от ${money(FREE_SHIPPING_FROM)}. Оплата: ${PAYMENTS.map((p) => p.title.toLowerCase()).join(' · ')}.</p>
        <p class="field__hint">Возврат 14 дней. Бирки не срезай — и всё пройдёт гладко.</p>
      </div>

      <div data-details></div>
    </div>

    <div class="sticky-buy" data-sticky-buy hidden>
      <div class="stack stack--sm" style="gap:.15rem">
        <span class="product__name" style="font-size:.7rem">${esc(product.name)}</span>
        <span class="price">${money(product.price)}</span>
      </div>
      <button class="btn btn--solid btn--sm" type="button" data-sticky-action>—</button>
    </div>`;

  /* ── зона покупки ── */
  const zone = $('[data-buy-zone]');
  const sticky = $('[data-sticky-buy]');
  const stickyBtn = $('[data-sticky-action]');

  const renderBuy = () => {
    zone.innerHTML = '';

    if (state === 'live') {
      const left = totalStock(product);
      const wrap = el('div', { class: 'stack' });

      const head = el('div', { class: 'opt-row' });
      head.append(
        el('span', { class: 'mono-label', text: 'Размер' }),
        el('span', {
          class: `stock-note${left <= 12 ? ' stock-note--hot' : ''}`,
          text: left <= 12 ? `осталось ${left}` : 'в наличии',
        }),
      );
      wrap.append(head);

      const grid = el('div', { class: 'size-grid', 'data-sizes': '', role: 'group', 'aria-label': 'Размер' });
      for (const s of sizes) {
        const qty = product.sizes[s];
        const btn = el('button', {
          class: 'size', type: 'button', 'data-size': s,
          'aria-pressed': String(chosen === s),
          disabled: qty === 0,
          title: qty === 0 ? 'Нет в наличии' : `Осталось ${qty}`,
        }, s);
        btn.addEventListener('click', () => {
          chosen = s;
          $$('.size', grid).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === s)));
          updateActions();
        });
        grid.append(btn);
      }
      wrap.append(grid);

      if (!product.sizes || !sizes.length) {
        wrap.append(el('p', { class: 'field__hint', text: 'Один размер — подойдёт всем.' }));
      } else if (!available.length) {
        wrap.append(el('p', { class: 'field__error', text: 'Размеров нет. Вещь распродана.' }));
      }

      const actions = el('div', { class: 'stack', 'data-actions': '', 'data-buy': '' });
      wrap.append(actions);

      const wish = el('button', { class: `btn btn--sm${wishlist.has(product.id) ? ' btn--violet' : ''}`, type: 'button', 'data-wish-btn': '' },
        wishlist.has(product.id) ? 'В вишлисте ✓' : 'В вишлист');
      wish.addEventListener('click', () => {
        const on = wishlist.toggle(product.id);
        wish.textContent = on ? 'В вишлисте ✓' : 'В вишлист';
        wish.classList.toggle('btn--violet', on);
        toast(on ? 'В вишлисте' : 'Убрано', on ? 'Напомним перед дропом.' : '', 2400);
      });

      const note = el('p', { class: 'field__hint', 'data-size-note': '' });
      wrap.append(el('div', { class: 'row row--wrap', style: 'gap:.5rem' }, wish), note);

      const updateActions = () => {
        actions.innerHTML = '';
        const add = el('button', {
          class: 'btn btn--solid btn--block btn--lg', type: 'button', 'data-add': '',
        }, chosen ? ('В корзину · ' + chosen) : 'В корзину · выбери размер');

        if (!chosen) {
          add.disabled = true;
          note.textContent = 'Сначала размер. Система не угадывает.';
        } else {
          const qty = product.sizes[chosen];
          note.textContent = qty <= 2 ? `Последние ${qty} шт. в размере ${chosen}.` : `Размер ${chosen} в наличии.`;
          add.addEventListener('click', () => {
            addToCart(product.id, chosen, 1, 'product');
            add.textContent = 'В корзине ✓';
            setTimeout(() => updateActions(), 1400);
          });
        }
        actions.append(add);

        const wl = el('button', { class: 'btn btn--violet btn--block', type: 'button', 'data-wait': '' },
          waitlist.has(product.id) ? 'Ты в листе ожидания' : 'Сообщить о возврате');
        wl.addEventListener('click', () => {
          const on = waitlist.toggle(product.id);
          wl.textContent = on ? 'Ты в листе ожидания' : 'Сообщить о возврате';
          toast(on ? 'Лист ожидания' : 'Убрали', on ? 'Если вещь вернётся — напишем первым.' : '', 2600);
        });
        actions.append(wl);

        if (stickyBtn) {
          stickyBtn.textContent = chosen ? ('В корзину · ' + chosen) : 'В корзину · выбери размер';
          stickyBtn.disabled = !chosen;
        }
      };

      updateActions();
      zone.append(wrap);
      if (sticky) {
        sticky.hidden = false;
        // на мобиле липкая кнопка занимает низ экрана — освобождаем ей место
        document.body.classList.add('has-sticky-buy');
      }
      return;
    }

    /* распродано */
    if (state === 'out') {
      const wrap = el('div', { class: 'stack' });
      wrap.append(el('p', { class: 'mono-label mono-label--hot', text: 'Распродано' }));
      wrap.append(el('p', {
        class: 'serif',
        style: 'font-size:var(--step-1)',
        text: 'Тираж кончился. Второго захода не будет — но если вещь вернётся, ты узнаешь первым.',
      }));

      const form = el('form', { class: 'stack', 'data-wait-form': '' });
      form.innerHTML = `
        <label class="field">
          <span class="field__label">Почта</span>
          <input class="input" type="email" name="email" placeholder="you@mail.ru" required>
        </label>
        <button class="btn btn--solid btn--block" type="submit">Встать в лист ожидания</button>
        <p class="field__hint">Один сигнал. Без «горячих предложений».</p>`;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = form.elements.email;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) {
          input.classList.add('is-bad');
          toast('Почта не та', 'Проверь адрес.');
          return;
        }
        input.classList.remove('is-bad');
        if (!waitlist.has(product.id)) waitlist.toggle(product.id);
        if (!queue.entry()) queue.join({ email: input.value.trim() });
        toast('Ты в листе', 'Свои заходят первыми. Держи почту под рукой.');
        form.innerHTML = '<p class="access-granted t-sm">ACCESS GRANTED</p>';
      });
      wrap.append(form);

      const wl = el('button', { class: 'btn btn--violet btn--block', type: 'button' }, 'В вишлист');
      wl.addEventListener('click', () => {
        const on = wishlist.toggle(product.id);
        wl.textContent = on ? 'В вишлисте ✓' : 'В вишлист';
        wl.classList.toggle('btn--violet', on);
      });
      wrap.append(wl);

      zone.append(wrap);
      return;
    }

    /* скоро */
    const wrap = el('div', { class: 'stack' });
    wrap.innerHTML = `
      <p class="mono-label mono-label--hot">Скоро · дроп 08</p>
      <p class="serif" style="font-size:var(--step-1)">Ты смотришь на дроп. Дроп смотрит на тебя. Откроется — скажем.</p>
      <div class="countdown" data-countdown>
        <div class="countdown__unit"><span class="countdown__val" data-cd="days">00</span><span class="countdown__label">дней</span></div>
        <span class="countdown__sep">:</span>
        <div class="countdown__unit"><span class="countdown__val" data-cd="hours">00</span><span class="countdown__label">часов</span></div>
        <span class="countdown__sep">:</span>
        <div class="countdown__unit"><span class="countdown__val" data-cd="minutes">00</span><span class="countdown__label">минут</span></div>
        <span class="countdown__sep">:</span>
        <div class="countdown__unit"><span class="countdown__val" data-cd="seconds">00</span><span class="countdown__label">секунд</span></div>
      </div>
      <a class="btn btn--solid btn--block" href="waitlist.html">Встать в очередь</a>`;
    zone.append(wrap);
    mountCountdown($('[data-countdown]', wrap), drop.date);
  };

  renderBuy();

  /* ── детали ── */
  const detailsHost = $('[data-details]');
  if (detailsHost) {
    const acc = detailsAccordion(product);
    acc.setAttribute('data-details', '');
    detailsHost.replaceWith(acc);
  }

  /* ── миниатюры ── */
  const main = $('[data-main-img]');
  $$('[data-thumb]').forEach((t) => t.addEventListener('click', () => {
    const src = main.src;
    main.src = t.src;
    t.src = src;
  }));

  /* ── липкая кнопка ── */
  stickyBtn?.addEventListener('click', () => {
    if (!chosen) return;
    addToCart(product.id, chosen, 1, 'product-sticky');
  });

  /* ── из дропа ── */
  const others = productsOfDrop(product.drop).filter((p) => p.id !== product.id);
  const similar = others.length ? others : PRODUCTS.filter((p) => p.kind === product.kind && p.id !== product.id).slice(0, 4);
  const block = $('[data-from-drop]');
  if (block) {
    block.innerHTML = `
      <div class="section-head">
        <div>
          <p class="mono-label mono-label--hot">Из дропа ${String(drop.n).padStart(2, '0')} · ${esc(drop.code)}</p>
          <h2 class="t-sm display" style="margin-top:.4rem">${esc(drop.thesis)}</h2>
        </div>
        <a class="link-underline" href="catalog.html?drop=${esc(drop.id)}">Вся капсула</a>
      </div>`;
    block.append(productGrid(similar.slice(0, 4)));
  }

  /* ── UGC ── */
  const ugc = $('[data-ugc-product]');
  if (ugc) ugc.replaceWith(ugcRail(UGC, { limit: 4 }));

  /* ── заголовок дропа в крошках ── */
  const crumb = $('[data-crumb]');
  if (crumb) crumb.textContent = `${drop.label} · ${drop.code}`;

  initReveal();
  store.on(() => { /* состояние корзины подхватывает общий слой */ });
}
