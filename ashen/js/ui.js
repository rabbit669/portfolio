/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — общие блоки интерфейса
   Карточка товара, таймер, UGC, тосты, шторка корзины.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  CURRENT_DROP, DROPS, KINDS, COLORS, SIZE_ORDER, PAYMENTS, DELIVERY,
  productState, PRODUCT_STATE_LABEL, hasSizes, totalStock, dropById, fmtDate, fmtTime,
} from './data.js';
import { cart, wishlist, queue, store, lineKey } from './store.js';
import { $, $$, el, esc, money, pad2, splitDuration } from './util.js';

/* re-export, чтобы страницы не тянули всё подряд */
export { lineKey };

/* ── карточка товара ───────────────────────────────────────────────────── */

export function productCard(product, { index = 0 } = {}) {
  const drop = dropById(product.drop);
  const state = productState(product);
  const inWish = wishlist.has(product.id);
  const flag =
    state === 'out' ? { text: 'Распродано', mod: '' } :
    state === 'soon' ? { text: 'Скоро', mod: 'product__flag--violet' } :
    product.hero ? { text: 'Главное', mod: 'product__flag--violet' } :
    product.oldPrice ? { text: '−11%', mod: '' } : null;

  const node = el('a', {
    class: `product${state === 'out' ? ' is-out' : ''}`,
    href: `product.html?id=${product.id}`,
    'data-reveal': '',
    style: `--d:${Math.min(index, 8) * 55}ms`,
    'aria-label': product.name,
  });

  node.innerHTML = `
    <div class="product__media">
      ${flag ? `<span class="product__flag ${flag.mod}">${esc(flag.text)}</span>` : ''}
      <button class="product__wish${inWish ? ' is-on' : ''}" type="button"
              data-wish="${esc(product.id)}"
              aria-label="${inWish ? 'Убрать из вишлиста' : 'В вишлист'}"
              aria-pressed="${inWish}">
        <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.35-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 15.65 12 20 12 20Z"/></svg>
      </button>
      <img class="product__img" src="assets/img/${esc(product.id)}.png" alt="${esc(product.name)}"
           loading="lazy" decoding="async" width="800" height="1000">
      <span class="glitch-layer glitch-layer--v" aria-hidden="true"></span>
      <span class="glitch-layer glitch-layer--c" aria-hidden="true"></span>
    </div>
    <div class="product__meta">
      <span class="product__drop">${esc(drop ? `${drop.label} · ${drop.code}` : '')}</span>
      <span class="product__name">${esc(product.name)}</span>
      <span class="product__line">
        <span class="price">${money(product.price)}</span>
        ${product.oldPrice ? `<span class="price price--strike">${money(product.oldPrice)}</span>` : ''}
      </span>
      <span class="product__desc">${esc(product.desc)}</span>
    </div>`;

  // сердечко не должно уводить на страницу товара
  node.querySelector('[data-wish]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.currentTarget;
    const on = wishlist.toggle(product.id);
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    document.dispatchEvent(new CustomEvent('ashen:wish', { detail: { id: product.id, on } }));
  });

  return node;
}

export function productGrid(products, opts = {}) {
  const grid = el('div', { class: 'pgrid' });
  products.forEach((p, i) => grid.append(productCard(p, { ...opts, index: i })));
  return grid;
}

/* ── таймер ────────────────────────────────────────────────────────────── */

/**
 * Живой отсчёт до дропа. Обновляет [data-cd] внутри root.
 * Если до дропа меньше 24 часов, «свои» видят окно раннего доступа.
 */
export function mountCountdown(root, target = CURRENT_DROP.date, { onDone } = {}) {
  if (!root) return () => {};
  const cells = {
    days: $('[data-cd="days"]', root),
    hours: $('[data-cd="hours"]', root),
    minutes: $('[data-cd="minutes"]', root),
    seconds: $('[data-cd="seconds"]', root),
  };
  const last = { days: null, hours: null, minutes: null, seconds: null };

  const paint = (key, value) => {
    const node = cells[key];
    if (!node) return;
    const text = pad2(value);
    if (node.textContent === text) return;
    node.textContent = text;
    node.classList.remove('is-flip');
    void node.offsetWidth;
    node.classList.add('is-flip');
    last[key] = text;
  };

  let finished = false;
  const tick = () => {
    const d = splitDuration(target - Date.now());
    paint('days', d.days);
    paint('hours', d.hours);
    paint('minutes', d.minutes);
    paint('seconds', d.seconds);
    document.documentElement.style.setProperty('--drop-ms', String(Math.max(0, target - Date.now())));
    if (d.done && !finished) { finished = true; onDone?.(); }
  };
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}

/** Строка «твой доступ» — раннее окно для своих. */
export function accessLine() {
  const access = queue.access();
  const ms = CURRENT_DROP.date - Date.now();
  if (access.lead > 0 && ms < access.lead * 3600 * 1000) {
    return { text: `Твой доступ открыт. Очередь ждёт ещё ${Math.ceil((access.lead * 3600 * 1000 - ms) / 3600000)} ч.`, hot: true };
  }
  if (access.key === 'none') {
    return { text: 'Ты пока не в очереди. Встань — свои заходят первыми.', hot: false };
  }
  return { text: `Твой класс: ${access.label}. Открытие — на ${access.lead || 0} ч раньше очереди.`, hot: access.lead > 0 };
}

/* ── блоки товара ──────────────────────────────────────────────────────── */

export function sizeButtons(product, { selected = null } = {}) {
  const wrap = el('div', { class: 'size-grid', role: 'group', 'aria-label': 'Размер' });
  const sizes = SIZE_ORDER.filter((s) => product.sizes && s in product.sizes);
  if (!sizes.length) return wrap;
  for (const s of sizes) {
    const left = product.sizes[s];
    const btn = el('button', {
      class: 'size', type: 'button', 'data-size': s,
      'aria-pressed': String(selected === s),
      disabled: left === 0,
      title: left === 0 ? 'Нет в наличии' : `Осталось ${left}`,
    }, s);
    wrap.append(btn);
  }
  return wrap;
}

export function accordion(sections) {
  const acc = el('div', { class: 'acc' });
  for (const [title, body] of sections) {
    if (!body) continue;
    const item = el('div', { class: 'acc__item' });
    item.innerHTML = `
      <button class="acc__btn" type="button" aria-expanded="false">
        <span>${esc(title)}</span><i aria-hidden="true"></i>
      </button>
      <div class="acc__panel"><div><div class="acc__body">${body}</div></div></div>`;
    item.querySelector('.acc__btn').addEventListener('click', () => {
      const open = item.classList.toggle('is-open');
      item.querySelector('.acc__btn').setAttribute('aria-expanded', String(open));
    });
    acc.append(item);
  }
  return acc;
}

/** Блок «Детали» из карточки товара. */
export function detailsAccordion(product) {
  const d = product.details || {};
  const kv = (obj) => Object.entries(obj)
    .filter(([, v]) => v)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  return accordion([
    ['Детали', `<dl class="kv">${kv({
      состав: d.состав, крой: d.крой, уход: d.уход, производство: d.производство,
      цвет: product.color, артикул: product.id.toUpperCase(),
    })}</dl>`],
    ['Размеры и посадка', `${esc(product.short || '')}
      <ul class="checks" style="margin-top:.75rem">
        <li>Модель на фото — 178 см, носит M.</li>
        <li>Остатки по размерам обновляются в реальном времени.</li>
        <li>Не подошло — вернём деньги в течение 14 дней.</li>
      </ul>`],
    ['Доставка', `Самовывоз в Москве — 1–2 дня. Курьер — завтра. СДЭК по России — 3–5 дней.
      Бесплатно от ${money(25000)}. Пакет непрозрачный, никто не поймёт, что внутри.`],
    ['Возврат', '14 дней на возврат, если бирки на месте. Деньги — обратно тем же способом.'],
  ]);
}

/* ── UGC ───────────────────────────────────────────────────────────────── */

export function ugcRail(items, { limit = 6 } = {}) {
  const rail = el('div', { class: 'ugc-rail' });
  for (const u of items.slice(0, limit)) {
    const tile = el('a', { class: 'ugc-tile', href: 'community.html#ugc', 'data-reveal': 'scale' });
    tile.innerHTML = `
      <img src="${esc(u.img)}" alt="UGC ${esc(u.by)}" loading="lazy" decoding="async" width="720" height="720">
      <span class="ugc-tile__by"><span>${esc(u.by)}</span><span>${esc(u.drop)}</span></span>`;
    rail.append(tile);
  }
  return rail;
}

/* ── тосты ─────────────────────────────────────────────────────────────── */

function toastHost() {
  let host = $('.toasts');
  if (!host) { host = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  return host;
}

export function toast(title, body = '', ms = 3600) {
  const host = toastHost();
  const node = el('div', { class: 'toast' });
  node.innerHTML = `<span class="toast__ico"></span>
    <span><span class="toast__title">${esc(title)}</span>
    ${body ? `<br><span class="toast__body">${esc(body)}</span>` : ''}</span>`;
  host.append(node);
  setTimeout(() => {
    node.classList.add('is-out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 600);
  }, ms);
  return node;
}

/* ── шторка корзины ────────────────────────────────────────────────────── */

export function mountCartDrawer() {
  const scrim = el('div', { class: 'scrim', 'data-scrim': '' });
  const drawer = el('aside', {
    class: 'drawer', id: 'cart-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Корзина',
  });
  drawer.innerHTML = `
    <header class="drawer__head">
      <span class="mono-label mono-label--hot">Корзина · <span data-cart-count>0</span></span>
      <button class="icon-btn" type="button" data-close aria-label="Закрыть">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </header>
    <div class="drawer__body" data-cart-body></div>
    <footer class="drawer__foot" data-cart-foot></footer>`;
  document.body.append(scrim, drawer);

  const body = $('[data-cart-body]', drawer);
  const foot = $('[data-cart-foot]', drawer);

  const paint = () => {
    const lines = cart.detailed();
    const count = cart.count();
    $$('[data-cart-count], [data-cart-badge]').forEach((n) => {
      n.textContent = String(count);
      if (n.classList.contains('badge')) n.hidden = count === 0;
    });

    if (!lines.length) {
      body.innerHTML = `
        <div class="empty-state">
          <span class="status status--out">0 позиций</span>
          <p class="t-sm display">Тут пусто. Как в твоём вишлисте.</p>
          <p class="body-muted measure-sm">Система ждёт. Дроп — в пятницу.</p>
          <a class="btn btn--sm" href="catalog.html">В каталог</a>
        </div>`;
      foot.innerHTML = '';
      return;
    }

    body.innerHTML = lines.map((l) => `
      <div class="line-item" data-key="${esc(l.key)}">
        <img class="line-item__img" src="assets/img/${esc(l.id)}.png" alt="" width="120" height="150" loading="lazy">
        <div>
          <div class="line-item__name">${esc(l.product.name)}</div>
          <div class="line-item__opt">${l.size ? `размер ${esc(l.size)}` : 'один размер'} · ${esc(l.product.color)}</div>
          <div class="line-item__ctrl">
            <span class="qty">
              <button type="button" data-q="-1" aria-label="Меньше">−</button>
              <span>${l.qty}</span>
              <button type="button" data-q="1" aria-label="Больше">+</button>
            </span>
            <button class="remove-x" type="button" data-remove>Убрать</button>
          </div>
        </div>
        <div class="right">
          <div class="price">${money(l.sum)}</div>
        </div>
      </div>`).join('');

    const sum = cart.subtotal();
    const shipping = sum >= 25000 ? 0 : 490;
    foot.innerHTML = `
      <div class="row row--between">
        <span class="mono-label">Товары</span><span class="price">${money(sum)}</span>
      </div>
      <div class="row row--between">
        <span class="mono-label">Доставка</span>
        <span class="price">${shipping === 0 ? 'бесплатно' : money(shipping)}</span>
      </div>
      ${shipping ? `<p class="field__hint">До бесплатной доставки — ${money(25000 - sum)}.</p>` : ''}
      <a class="btn btn--solid btn--block" href="cart.html">Оформить</a>
      <button class="btn btn--ghost btn--block btn--sm" type="button" data-close>Продолжить</button>`;

    body.querySelectorAll('.line-item').forEach((row) => {
      const key = row.dataset.key;
      row.querySelector('[data-q="-1"]')?.addEventListener('click', () => {
        const line = cart.items().find((l) => lineKey(l.id, l.size) === key);
        cart.setQty(key, (line?.qty || 1) - 1);
      });
      row.querySelector('[data-q="1"]')?.addEventListener('click', () => {
        const line = cart.items().find((l) => lineKey(l.id, l.size) === key);
        cart.setQty(key, (line?.qty || 0) + 1);
      });
      row.querySelector('[data-remove]')?.addEventListener('click', () => cart.remove(key));
    });
  };

  const open = () => {
    paint();
    scrim.classList.add('is-open');
    drawer.classList.add('is-open');
    document.body.classList.add('is-locked');
    drawer.querySelector('[data-close]')?.focus();
  };
  const close = () => {
    scrim.classList.remove('is-open');
    drawer.classList.remove('is-open');
    document.body.classList.remove('is-locked');
  };

  scrim.addEventListener('click', close);
  drawer.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-cart]')) { e.preventDefault(); open(); }
  });
  document.addEventListener('ashen:cart-open', open);
  store.on(paint);
  paint();

  return { open, close, repaint: paint };
}

/* ── кнопка «в корзину» как единый компонент ───────────────────────────── */

export function addToCart(id, size, qty = 1, source = 'unknown') {
  const added = cart.add(id, size, qty);
  if (!added) return false;
  store.get(); // состояние уже обновлено
  toast('Добавлено в корзину', `${size ? `Размер ${size}. ` : ''}Открыть корзину?`, 2800);
  document.dispatchEvent(new CustomEvent('ashen:added', { detail: { id, size, qty, source } }));
  return true;
}
