/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — оболочка системы
   Прелоадер, навигация, подвал, шторка корзины, переходы между страницами.
   Подключается на каждой странице: <script type="module" src="js/app.js">
   ═══════════════════════════════════════════════════════════════════════════ */

import { BRAND, CURRENT_DROP, DROPS, fmtDate, fmtTime, fmtWeekday, QUEUE_GOAL } from './data.js';
import { cart, queue, wishlist, visitCount, emit, store } from './store.js';
import {
  $, $$, el, esc, initReveal, initParallax, initCursor, initScrollRail, sleep,
  qsParam, safeStore,
} from './util.js';
import { mountCartDrawer, mountCountdown, toast } from './ui.js';

const PAGE = document.body.dataset.page || 'home';
const NAV = [
  { id: 'home', label: 'Главная', href: 'index.html' },
  { id: 'catalog', label: 'Каталог', href: 'catalog.html' },
  { id: 'community', label: 'Комьюнити', href: 'community.html' },
  { id: 'media', label: 'Медиа', href: 'media.html' },
  { id: 'account', label: 'Кабинет', href: 'account.html' },
];

const ICONS = {
  cart: '<svg viewBox="0 0 24 24"><path d="M4 6h16l-1.4 11.2A2 2 0 0 1 16.6 19H7.4a2 2 0 0 1-2-1.8L4 6Z"/><path d="M9 6V5a3 3 0 0 1 6 0v1"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  shop: '<svg viewBox="0 0 24 24"><path d="M4 8h16v12H4z"/><path d="M4 8l2-4h12l2 4"/><path d="M9 12h6"/></svg>',
  feed: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/></svg>',
  tg: '<svg viewBox="0 0 24 24"><path d="M21 5L3 11.5l5 1.8L19 7l-8.5 8.2.3 4.3L14 16l5-11"/></svg>',
  vk: '<svg viewBox="0 0 24 24"><path d="M4 8c.6 4.6 3.2 8 7.2 8h1.4v-3.1c1.6.7 2.6 2.1 3.1 3.1H19c-.5-1.7-1.7-3.4-3.2-4.3 1.3-1 2.3-2.4 2.7-4h-3c-.4 1.4-1.3 2.7-2.9 3.2V7.7h-1.5v4c-1.6-.7-3-2.6-3.3-4H4Z"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24"><path d="M14 4v9.5a3.5 3.5 0 1 1-3-3.46"/><path d="M14 5.5c.7 1.9 2.2 3 4 3.2"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-1 7 8-11h-6l1-7Z"/></svg>',
};

const navIcon = (id) => ICONS[id] || ICONS.feed;

/* ── прелоадер ─────────────────────────────────────────────────────────── */

const BOOT_LINES = [
  '> инициализация ashen.os',
  '> проверка доступа',
  '> синхронизация очереди',
  '> статус системы: активна',
];

async function preloader() {
  const root = $('[data-preloader]');
  if (!root) return;

  const line = $('.preloader__line', root);
  const sub = $('.preloader__sub', root);
  const bar = $('.preloader__bar span', root);
  const pct = $('.preloader__pct', root);
  const boot = $('.preloader__boot', root);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const alreadySeen = safeStore.get('ashen.booted', false);
  // ?noboot — для проверок и скриншотов: вход в систему без анимации
  const skip = new URLSearchParams(location.search).has('noboot');
  if (skip || (alreadySeen && sessionStorage.getItem('ashen.session') === '1')) { root.remove(); return; }
  safeStore.set('ashen.booted', true);
  try { sessionStorage.setItem('ashen.session', '1'); } catch { /* тихо */ }

  document.body.classList.add('is-locked');

  const steps = [
    { t: 'ASHEN', s: 'тише. свет уже погас.' },
    { t: 'СИСТЕМА АКТИВНА', s: 'дроп ' + String(CURRENT_DROP.n).padStart(2, '0') + ': ' + CURRENT_DROP.code },
    { t: BRAND.preloader, s: 'добро пожаловать в закрытый список.' },
  ];

  const totalMs = reduce ? 400 : 2600;
  const t0 = performance.now();

  // boot-лог строится построчно, как в старых терминалах
  boot.innerHTML = '';
  for (const bl of BOOT_LINES) {
    const n = el('div', { text: bl });
    boot.append(n);
    n.style.opacity = '0';
    n.style.transition = 'opacity .3s linear';
  }

  const paint = () => {
    const p = Math.min(1, (performance.now() - t0) / totalMs);
    bar.style.width = `${(p * 100).toFixed(0)}%`;
    pct.textContent = `${String(Math.round(p * 100)).padStart(3, '0')}%`;
    const idx = Math.min(steps.length - 1, Math.floor(p * steps.length));
    const step = steps[idx];
    if (line.dataset.step !== String(idx)) {
      line.dataset.step = String(idx);
      line.innerHTML = idx === 2
        ? 'ACCESS <span class="glowword">GRANTED</span>'
        : esc(step.t);
      sub.textContent = step.s;
    }
    boot.querySelectorAll('div').forEach((n, i) => {
      n.style.opacity = p * BOOT_LINES.length > i ? '1' : '0';
    });
    if (p < 1) requestAnimationFrame(paint);
    else finish();
  };

  const finish = async () => {
    root.classList.add('is-done');
    document.body.classList.remove('is-locked');
    await sleep(reduce ? 50 : 620);
    root.remove();
    document.dispatchEvent(new CustomEvent('ashen:booted'));
    if (!alreadySeen) {
      await sleep(400);
      const access = queue.access();
      toast(access.key === 'none' ? 'Ты не в очереди' : 'Ты в системе', access.key === 'none'
        ? 'Встань в лист ожидания — свои заходят первыми.'
        : `Класс доступа: ${access.label}.`, 4200);
    }
  };

  requestAnimationFrame(paint);
}

/* ── навигация ─────────────────────────────────────────────────────────── */

function mountNav() {
  const host = $('[data-nav]');
  if (!host) return;
  const count = cart.count();
  const wishCount = wishlist.count();

  host.className = 'nav';
  host.innerHTML = `
    <div class="nav__inner">
      <a class="brand" href="index.html">${esc(BRAND.name)}<span class="brand__dot" aria-hidden="true"></span></a>

      <nav class="nav__links" aria-label="Основная навигация">
        ${NAV.map((n) => `<a class="nav__link" href="${n.href}"${n.id === PAGE ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`).join('')}
      </nav>

      <div class="nav__actions">
        <a class="icon-btn" href="account.html" aria-label="Кабинет">
          ${ICONS.user}
          ${wishCount ? `<span class="badge" data-wish-badge>${wishCount}</span>` : ''}
        </a>
        <button class="icon-btn" type="button" data-open-cart aria-label="Корзина">
          ${ICONS.cart}
          <span class="badge" data-cart-badge ${count ? '' : 'hidden'}>${count}</span>
        </button>
        <div class="nav__toggle">
          <input type="checkbox" id="nav-burger" class="sr-only" aria-label="Меню">
          <label class="nav__burger" for="nav-burger" aria-hidden="true"><i></i></label>
        </div>
      </div>
    </div>`;

  const burger = $('#nav-burger', host);
  burger?.addEventListener('change', () => {
    $('.nav__links', host).classList.toggle('is-open', burger.checked);
    document.body.classList.toggle('is-locked', burger.checked);
  });
  $$('.nav__link', host).forEach((a) => a.addEventListener('click', () => {
    if (burger) burger.checked = false;
    $('.nav__links', host).classList.remove('is-open');
    document.body.classList.remove('is-locked');
  }));

  store.on(() => {
    const c = cart.count();
    $$('[data-cart-badge]').forEach((n) => { n.textContent = String(c); n.hidden = c === 0; });
    const w = wishlist.count();
    const wb = $('[data-wish-badge]', host);
    if (wb) { wb.textContent = String(w); wb.hidden = w === 0; }
  });

  const stuck = () => host.classList.toggle('is-stuck', window.scrollY > 12);
  addEventListener('scroll', stuck, { passive: true });
  stuck();
}

function mountDock() {
  const items = [
    { id: 'home', href: 'index.html', label: 'Главная', icon: 'shop' },
    { id: 'catalog', href: 'catalog.html', label: 'Каталог', icon: 'search' },
    { id: 'community', href: 'community.html', label: 'Свои', icon: 'feed' },
    { id: 'media', href: 'media.html', label: 'Медиа', icon: 'clock' },
    { id: 'cart', href: '#', label: 'Корзина', icon: 'cart', cart: true },
  ];
  const count = cart.count();
  const dock = el('nav', { class: 'dock', 'aria-label': 'Быстрый доступ' });
  dock.innerHTML = items.map((i) => `
    <a class="dock__item" href="${i.href}" ${i.cart ? 'data-open-cart' : ''}
       ${i.id === PAGE ? 'aria-current="page"' : ''}>
      ${navIcon(i.icon)}<span>${i.label}</span>
      ${i.cart && count ? `<span class="badge" data-cart-badge>${count}</span>` : ''}
    </a>`).join('');
  document.body.append(dock);
}

/* ── подвал ────────────────────────────────────────────────────────────── */

function mountFooter() {
  const host = $('[data-footer]');
  if (!host) return;
  host.className = 'footer';
  host.innerHTML = `
    <div class="wrap">
      <div class="footer__grid">
        <div>
          <a class="brand" href="index.html" style="font-size:1.6rem">${esc(BRAND.name)}<span class="brand__dot" aria-hidden="true"></span></a>
          <p class="serif" style="margin-top:1rem;max-width:34ch">${esc(BRAND.tagline)}</p>
          <p class="mono-label" style="margin-top:1.25rem">Очередь · <span data-queue-inline>—</span></p>
          <div class="inline-form" style="margin-top:1rem;max-width:26rem">
            <input class="input" type="email" placeholder="почта для сигнала" data-footer-email aria-label="Email">
            <button class="btn btn--sm btn--violet" type="button" data-footer-join>В очередь</button>
          </div>
        </div>
        <div>
          <h3 class="footer__title">Система</h3>
          <div class="footer__links">
            <a href="catalog.html">Каталог</a>
            <a href="catalog.html?drop=drop-07">Текущий дроп</a>
            <a href="waitlist.html">Лист ожидания</a>
            <a href="community.html">Комьюнити</a>
            <a href="media.html">Медиа</a>
          </div>
        </div>
        <div>
          <h3 class="footer__title">Кабинет</h3>
          <div class="footer__links">
            <a href="account.html">Профиль</a>
            <a href="account.html#orders">Заказы</a>
            <a href="account.html#wishlist">Вишлист</a>
            <a href="account.html#referral">Инвайты</a>
            <a href="cart.html">Корзина</a>
          </div>
        </div>
        <div>
          <h3 class="footer__title">Связь</h3>
          <div class="footer__links">
            ${BRAND.socials.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${esc(s.name)} · ${esc(s.handle)}</a>`).join('')}
            <a href="mailto:${esc(BRAND.email)}">${esc(BRAND.email)}</a>
          </div>
          <h3 class="footer__title" style="margin-top:1.5rem">Документы</h3>
          <div class="footer__links">
            <a href="offer.html">Публичная оферта</a>
            <a href="privacy.html">Политика данных</a>
            <a href="consent.html">Согласие на обработку</a>
          </div>
        </div>
      </div>

      <div class="footer__sign" aria-hidden="true">${esc(BRAND.name)}</div>

      <div class="footer__bottom">
        <span>© ${new Date().getFullYear()} ${esc(BRAND.name)} · ${esc(BRAND.city)}</span>
        <span>${esc(BRAND.tagline)}</span>
        <span>Оплата: карта · СБП · рассрочка</span>
      </div>
    </div>`;

  const updateQueue = () => {
    const n = queue.size();
    $('[data-queue-inline]', host).textContent = `${new Intl.NumberFormat('ru-RU').format(n)} / ${new Intl.NumberFormat('ru-RU').format(QUEUE_GOAL)}`;
  };
  updateQueue();
  store.on(updateQueue);

  $('[data-footer-join]', host)?.addEventListener('click', async () => {
    const input = $('[data-footer-email]', host);
    if (!input) return;
    const value = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      input.classList.add('is-bad');
      toast('Почта не та', 'Проверь адрес — сигнал должен дойти.');
      return;
    }
    input.classList.remove('is-bad');
    queue.join({ email: value });
    toast('Ты в очереди', `Позиция ${queue.position()}. Свои заходят первыми.`);
    input.value = '';
  });
}

/* ── служебные напоминания ─────────────────────────────────────────────── */

function scheduleDropPings() {
  const fire = (label, ms) => setTimeout(() => {
    const pos = queue.position();
    toast(label, pos ? `Твоя позиция: ${pos}.` : 'Ты пока не в очереди.', 6000);
    store.get();
  }, ms);
  const until = CURRENT_DROP.date - Date.now();
  if (until > 0) {
    fire('2 часа до дропа. Ты в очереди?', Math.max(0, until - 2 * 3600e3));
    fire('Дроп открыт', Math.max(0, until + 500));
  }
}

/* ── переходы между страницами ─────────────────────────────────────────── */

function initPageTransitions() {
  const veil = el('div', {
    'aria-hidden': 'true',
    style: 'position:fixed;inset:0;z-index:900;background:#050505;opacity:0;pointer-events:none;transition:opacity .28s ease',
  });
  document.body.append(veil);

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || a.target === '_blank' || a.hasAttribute('data-open-cart')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || url.pathname === location.pathname && url.search === location.search) return;
    e.preventDefault();
    veil.style.opacity = '1';
    setTimeout(() => { location.href = url.href; }, 240);
  });

  addEventListener('pageshow', () => { veil.style.opacity = '0'; });
}

/* ── реферальные ссылки ────────────────────────────────────────────────── */

function handleReferral() {
  const ref = qsParam('ref');
  if (ref) safeStore.set('ashen.lastRef', ref);
  if (!ref) return;
  if (queue.acceptInvite(ref)) {
    setTimeout(() => toast('Инвайт принят', 'Ты по ссылке своих. Встань в очередь, чтобы закрепить позицию.', 5200), 1200);
  }
}

/* ── загрузка модуля страницы ──────────────────────────────────────────── */

async function loadPageModule() {
  const map = {
    home: () => import('./pages/home.js'),
    catalog: () => import('./pages/catalog.js'),
    product: () => import('./pages/product.js'),
    cart: () => import('./pages/cart.js'),
    checkout: () => import('./pages/checkout.js'),
    payment: () => import('./pages/payment.js'),
    account: () => import('./pages/account.js'),
    community: () => import('./pages/community.js'),
    media: () => import('./pages/media.js'),
    waitlist: () => import('./pages/waitlist.js'),
  };
  const load = map[PAGE];
  if (!load) return;
  try {
    const mod = await load();
    await mod.default?.({ page: PAGE });
  } catch (err) {
    console.error('[ashen] страница не поднялась:', err);
    const main = $('main');
    if (main) {
      main.insertAdjacentHTML('afterbegin', `
        <div class="wrap section">
          <div class="panel panel--violet">
            <p class="mono-label mono-label--hot">Сбой</p>
            <p class="t-sm display" style="margin:.5rem 0">Страница не поднялась.</p>
            <p class="body-muted">${esc(err?.message || 'неизвестная ошибка')}</p>
          </div>
        </div>`);
    }
  }
}

/* ── старт ─────────────────────────────────────────────────────────────── */

async function boot() {
  visitCount();
  handleReferral();

  mountNav();
  mountDock();
  mountFooter();
  mountCartDrawer();
  initCursor();
  initScrollRail();
  initPageTransitions();

  await preloader();

  // контент страницы
  await loadPageModule();

  emit();
  initReveal();
  initParallax();
  scheduleDropPings();

  // глобальный ESC по оверлеям
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#nav-burger') && ($('#nav-burger').checked = false);
      $('.nav__links')?.classList.remove('is-open');
      document.body.classList.remove('is-locked');
    }
  });

  document.dispatchEvent(new CustomEvent('ashen:ready'));
  window.__ASHEN_READY__ = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

/* мелкие утилиты наружу — страницам иногда нужно */
export { toast };
