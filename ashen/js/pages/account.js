/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — личный кабинет
   Заказы, вишлист, дроп-статус, реферальная система и инвайты.

   Заказы теперь живут на сервере: он один знает, оплачен заказ или нет.
   Локальный список остаётся только как запасной вариант, если сервер выключен.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  CURRENT_DROP, QUEUE_GOAL, REFERRAL_REWARD, DROPS, PERKS,
  productsOfDrop, totalStock, fmtDate, fmtWeekday, fmtTime, inStock, productById,
} from '../data.js';
import {
  user, queue, cart, wishlist, waitlist, orders, ORDER_STATUS, notif, store, summary,
} from '../store.js';
import { $, $$, el, esc, money, pad2, splitDuration, safeStore, initReveal, pluralize } from '../util.js';
import { productGrid, toast, mountCountdown } from '../ui.js';
import { listOrders, syncOrder, lastPayment } from '../payments.js';

const nf = new Intl.NumberFormat('ru-RU');
const dt = (ms) => new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

const TABS = [
  { id: 'orders', label: 'Заказы' },
  { id: 'wishlist', label: 'Вишлист' },
  { id: 'drop', label: 'Дроп-статус' },
  { id: 'referral', label: 'Инвайты' },
  { id: 'settings', label: 'Настройки' },
];

export default async function account() {
  const host = $('[data-account]');
  const auth = $('[data-account-auth]');
  const lead = $('[data-account-lead]');
  if (!host) return;

  const tabFromHash = () => {
    const t = (location.hash || '#orders').slice(1);
    return TABS.some((x) => x.id === t) ? t : 'orders';
  };
  let active = tabFromHash();

  /* Заказы с сервера. Грузим один раз, потом обновляем по кнопке. */
  const ordersState = {
    loading: false, remote: [], error: null, loaded: false,
    code: '', verifiedBy: 'none', needCode: false, count: 0,
  };

  /* ── вход ── */
  const drawAuth = () => {
    if (!auth) return;
    if (user.signedIn()) {
      const u = user.get();
      auth.innerHTML = `
        <div class="stack stack--sm" style="min-width:14rem">
          <span class="mono-label">Вы вошли</span>
          <span class="product__name">${esc(u.name || u.email)}</span>
          <span class="field__hint">${esc(u.email)} · с ${new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(u.since))}</span>
          <button class="btn btn--ghost btn--sm" type="button" data-signout style="justify-content:flex-start">Выйти</button>
        </div>`;
      $('[data-signout]', auth)?.addEventListener('click', () => {
        user.signOut();
        toast('Вышли', 'Система помнит тебя по почте. Вернёшься — узнает.', 3000);
        paint();
      });
      return;
    }

    auth.innerHTML = `
      <form class="stack stack--sm" data-signin style="min-width:16rem">
        <span class="mono-label mono-label--hot">Вход по почте</span>
        <input class="input" type="email" name="email" placeholder="you@mail.ru" autocomplete="email"
               value="${esc(queue.entry()?.email || '')}" required>
        <input class="input" type="text" name="name" placeholder="имя (по желанию)" autocomplete="given-name">
        <button class="btn btn--sm" type="submit">Открыть кабинет</button>
      </form>`;
    $('[data-signin]', auth)?.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = e.target.elements.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        e.target.elements.email.classList.add('is-bad');
        toast('Почта не та', 'Без почты кабинет не открыть.');
        return;
      }
      user.signIn({ email, name: e.target.elements.name.value.trim() });
      if (!queue.entry()) queue.join({ email });
      toast('Доступ разрешён', 'Кабинет открыт. Очередь, заказы, инвайты — всё внутри.', 3400);
      ordersState.loaded = false;
      paint();
      if (active === 'orders') loadOrders();
    });
  };

  /* ── панели ── */

  /**
   * Заказы: источник истины — сервер. Если он недоступен, показываем то, что
   * успело сохраниться локально, и честно об этом пишем. Демо-заказ из
   * прошлого визита в этом случае не подмешиваем.
   */
  const panelOrders = () => {
    const email = user.get()?.email;
    if (!email) {
      return `<div class="empty-state">
        <span class="status status--out">вход не выполнен</span>
        <p class="t-sm display">Войди по почте, чтобы увидеть заказы.</p>
        <p class="body-muted measure-sm">Заказы привязаны к почте, на которую оформлен чек.</p>
      </div>`;
    }

    if (ordersState.loading) {
      return `<div class="panel" style="display:grid;gap:.85rem;justify-items:start">
        <span class="status status--live">загружаем</span>
        <p class="t-xs display">СПРАШИВАЕМ СЕРВЕР…</p>
        <span class="spinner"></span>
      </div>`;
    }

    const list = ordersState.remote.length ? ordersState.remote : orders.cached();
    if (ordersState.error && !list.length) {
      return `<div class="panel panel--violet" style="display:grid;gap:.85rem">
        <span class="status status--out">сервер заказов не отвечает</span>
        <p class="t-xs display">ПОКАЗЫВАЕМ ЛОКАЛЬНУЮ КОПИЮ</p>
        <p class="body-muted measure">
          ${esc(ordersState.error)}. Запусти <code>node server/server.mjs</code>, и заказы подтянутся
          вместе со статусами оплаты.
        </p>
        <button class="btn btn--sm" type="button" data-orders-retry>Проверить снова</button>
      </div>`;
    }
    if (!list.length) {
      return `<div class="empty-state">
        <span class="status status--out">заказов нет</span>
        <p class="t-sm display">Пока ничего не куплено.</p>
        <p class="body-muted measure-sm">Первый заказ — самый тихий. Дальше будет проще.</p>
        <a class="btn btn--sm" href="catalog.html?drop=${esc(CURRENT_DROP.id)}">Смотреть дроп 07</a>
      </div>`;
    }
    const isRemote = !!ordersState.remote.length;

    /* Токена владения нет (например, куплено с другого устройства) — просим
       номер заказа из письма. Так чужой человек по одной почте ничего не увидит. */
    if (!isRemote && ordersState.needCode) {
      return `<div class="panel panel--violet" style="display:grid;gap:1rem">
        <span class="status status--soon">нужен номер заказа</span>
        <p class="t-xs display">НА ЭТУ ПОЧТУ ЕСТЬ ЗАКАЗЫ — ${ordersState.count}</p>
        <p class="body-muted measure">
          Заказы привязаны к почте, но список по одной почте мы не отдаём: иначе любой,
          кто знает адрес, увидел бы все покупки. Введи номер из письма — покажем.
        </p>
        <form class="inline-form" data-order-code>
          <input class="input" type="text" name="code" placeholder="ASH-2026-0000" aria-label="Номер заказа">
          <button class="btn btn--sm" type="submit">Показать</button>
        </form>
        <p class="field__error" data-code-error hidden></p>
      </div>`;
    }
    const statusMeta = (o) => (isRemote
      ? { label: o.statusLabel, note: o.statusNote }
      : (ORDER_STATUS[o.status] || ORDER_STATUS.reserved));

    return `<div class="stack stack--lg" data-orders>
      ${list.map((o) => {
        const st = statusMeta(o);
        return `
        <article class="order-card" data-order="${esc(o.number)}">
          <header class="order-card__head">
            <div class="stack stack--sm">
              <span class="mono-label mono-label--hot">${esc(o.number)}${o.demo ? ' · демо-заказ' : ''}</span>
              <span class="field__hint">${esc(dt(o.at || Date.parse(o.createdAt)))} · ${esc(o.deliveryTitle)}</span>
            </div>
            <div class="stack stack--sm right">
              <span class="status ${/paid|delivered/.test(o.status) ? 'status--live' : 'status--out'}">${esc(st.label)}</span>
              <span class="price">${money(o.total)}</span>
            </div>
          </header>
          <div class="stack stack--sm">
            ${o.items.map((i) => `
              <div class="order-line">
                <img src="${esc(i.img)}" alt="" width="54" height="68" loading="lazy">
                <div class="stack stack--sm" style="gap:.2rem">
                  <a class="line-item__name" href="product.html?id=${esc(i.id)}">${esc(i.name)}</a>
                  <span class="line-item__opt">${i.size ? `размер ${esc(i.size)}` : 'один размер'} · ${i.qty} шт.</span>
                </div>
                <span class="price" style="font-size:var(--step--1)">${money(i.sum)}</span>
              </div>`).join('')}
          </div>
          <footer class="row row--between row--wrap" style="border-top:1px solid var(--ash-line);padding-top:.85rem">
            <span class="field__hint">
              ${esc(st.note)}
              ${isRemote && o.methodTitle ? ` · оплата: ${esc(o.methodTitle)}` : ''}
              ${isRemote && o.refundedAmount && Number(o.refundedAmount) ? ` · возвращено ${money(o.refundedAmount)}` : ''}
            </span>
            <div class="row row--wrap" style="gap:.5rem">
              <button class="btn btn--ghost btn--sm" type="button" data-repeat="${esc(o.number)}">Повторить заказ</button>
              <button class="btn btn--ghost btn--sm" type="button" data-receipt="${esc(o.number)}">Чек</button>
              ${isRemote && o.payment && (o.status === 'pending' || o.status === 'created')
                ? `<button class="btn btn--violet btn--sm" type="button" data-sync="${esc(o.id)}">Проверить оплату</button>` : ''}
            </div>
          </footer>
        </article>`;
      }).join('')}
    </div>`;
  };

  const panelWishlist = () => {
    const items = wishlist.products();
    const wait = waitlist.ids().map(productById).filter(Boolean);
    if (!items.length && !wait.length) {
      return `<div class="empty-state">
        <span class="status status--out">пусто</span>
        <p class="t-sm display">Вишлист пуст. Тут пусто. Как в твоём вишлисте.</p>
        <p class="body-muted measure-sm">Отмечай вещи сердечком — напомним перед дропом, пока не разобрали.</p>
        <a class="btn btn--sm" href="catalog.html">В каталог</a>
      </div>`;
    }
    return `
      ${items.length ? `<div class="stack"><p class="mono-label mono-label--hot">Отложено · ${items.length}</p><div data-wishlist-grid></div></div>` : ''}
      ${wait.length ? `<div class="stack" style="margin-top:1.5rem">
        <p class="mono-label mono-label--hot">Лист ожидания по вещам · ${wait.length}</p>
        <div class="stack stack--sm">
          ${wait.map((p) => `<div class="row row--between" style="border-bottom:1px solid var(--ash-line);padding:.6rem 0">
            <a href="product.html?id=${esc(p.id)}" class="line-item__name">${esc(p.name)}</a>
            <span class="field__hint">${inStock(p) ? 'уже в наличии — успей' : 'ждём возврата'}</span>
          </div>`).join('')}
        </div>
      </div>` : ''}`;
  };

  const panelDrop = () => {
    const s = summary();
    const access = s.access;
    const items = productsOfDrop(CURRENT_DROP.id);
    const left = items.reduce((n, p) => n + totalStock(p), 0);
    return `
      <div class="stack stack--lg">
        <div class="panel panel--violet queue-card">
          <div class="split" style="align-items:center">
            <div class="stack">
              <p class="mono-label mono-label--hot">Ближайший дроп · ${esc(CURRENT_DROP.label)}: ${esc(CURRENT_DROP.code)}</p>
              <p class="t-sm display" style="margin:.35rem 0">${esc(fmtWeekday(CURRENT_DROP.date))}, ${esc(fmtDate(CURRENT_DROP.date))} · ${esc(fmtTime(CURRENT_DROP.date))}</p>
              <div class="countdown" data-countdown style="margin-top:.6rem">
                <div class="countdown__unit"><span class="countdown__val" data-cd="days">00</span><span class="countdown__label">дней</span></div>
                <span class="countdown__sep">:</span>
                <div class="countdown__unit"><span class="countdown__val" data-cd="hours">00</span><span class="countdown__label">часов</span></div>
                <span class="countdown__sep">:</span>
                <div class="countdown__unit"><span class="countdown__val" data-cd="minutes">00</span><span class="countdown__label">минут</span></div>
                <span class="countdown__sep">:</span>
                <div class="countdown__unit"><span class="countdown__val" data-cd="seconds">00</span><span class="countdown__label">секунд</span></div>
              </div>
            </div>
            <div class="stack stack--sm">
              <span class="mono-label">Твой доступ</span>
              <span class="access-granted t-sm" data-access-class>${esc(access.label)}</span>
              <span class="field__hint">${access.lead ? `Заходишь на ${access.lead} ч раньше очереди.` : 'Пока как все: в 20:00. Приведи друга — откроется раньше.'}</span>
              <span class="mono-label" style="margin-top:.5rem">Осталось в дропе</span>
              <span class="price">${left} ${pluralize(left, ['позиция', 'позиции', 'позиций'])}</span>
            </div>
          </div>
        </div>

        <div class="stat-row">
          <div class="stat panel"><span class="stat__val" data-my-position>${s.position ?? '—'}</span><span class="stat__label">позиция в очереди</span></div>
          <div class="stat panel"><span class="stat__val">${nf.format(s.queueSize)}</span><span class="stat__label">всего в очереди</span></div>
          <div class="stat panel"><span class="stat__val">${s.friends}</span><span class="stat__label">приведено друзей</span></div>
          <div class="stat panel"><span class="stat__val">${s.invites}</span><span class="stat__label">инвайтов на руках</span></div>
        </div>

        <div class="stack">
          <div class="row row--between"><span class="mono-label">Прогресс капсулы</span><span class="mono-label">${left} в наличии</span></div>
          <div class="progress"><span style="width:${Math.max(4, Math.min(100, 100 - (left / Math.max(1, items.length * 8)) * 100)).toFixed(0)}%"></span></div>
          <p class="field__hint">Полоска показывает, сколько уже разобрали. Когда дойдёт до конца — дроп закрыт.</p>
        </div>
      </div>`;
  };

  const panelReferral = () => {
    const entry = queue.entry();
    const link = queue.referralLink();
    const code = queue.code();
    const friends = entry?.friends || 0;

    if (!entry) {
      return `<div class="panel panel--violet stack">
        <p class="mono-label mono-label--hot">Сначала очередь</p>
        <p class="t-sm display">Рефералка включается, когда ты в листе.</p>
        <p class="body-muted measure-sm">Встань в очередь — получишь код и ссылку. Приведи друга: он заходит раньше, ты поднимаешься вверх.</p>
        <a class="btn btn--sm" href="waitlist.html">Встать в очередь</a>
      </div>`;
    }

    const nextInvite = REFERRAL_REWARD.inviteEvery - (friends % REFERRAL_REWARD.inviteEvery);
    return `
      <div class="stack stack--lg">
        <div class="panel panel--violet invite-card">
          <p class="mono-label mono-label--hot">Твой код</p>
          <p class="invite-code" data-my-code>${esc(code)}</p>
          <p class="body-muted measure-sm">
            Приведи друга — зайдёшь раньше. Каждый друг поднимает тебя на ${REFERRAL_REWARD.perFriend} позиций.
          </p>
          <label class="field">
            <span class="field__label">Ссылка для своих</span>
            <input class="input" type="text" readonly value="${esc(link || '')}" data-referral-link aria-label="Реферальная ссылка">
          </label>
          <div class="row row--wrap">
            <button class="btn btn--solid btn--sm" type="button" data-copy-link>Скопировать ссылку</button>
            <button class="btn btn--violet btn--sm" type="button" data-share-link>Поделиться</button>
            <button class="btn btn--ghost btn--sm" type="button" data-demo-friend>Имитировать друга</button>
          </div>
        </div>

        <div class="stat-row">
          <div class="stat panel"><span class="stat__val">${friends}</span><span class="stat__label">друзей по ссылке</span></div>
          <div class="stat panel"><span class="stat__val">+${friends * REFERRAL_REWARD.perFriend}</span><span class="stat__label">позиций вверх</span></div>
          <div class="stat panel"><span class="stat__val">${queue.invites()}</span><span class="stat__label">инвайтов</span></div>
          <div class="stat panel"><span class="stat__val">${friends % REFERRAL_REWARD.inviteEvery ? nextInvite : 0}</span><span class="stat__label">до след. инвайта</span></div>
        </div>

        <div class="panel">
          <p class="mono-label mono-label--hot">Как это работает</p>
          <ul class="checks" style="margin-top:.85rem">
            <li>Друг открывает ссылку и встаёт в очередь — он получает доступ на ${REFERRAL_REWARD.inviteLeadHours} ч раньше остальных.</li>
            <li>Ты поднимаешься на ${REFERRAL_REWARD.perFriend} позиций за каждого.</li>
            <li>Каждые ${REFERRAL_REWARD.inviteEvery} друга — инвайт для человека вне очереди.</li>
            <li>6 друзей — класс «ядро»: заходишь ещё раньше и видишь вещи до анонса.</li>
          </ul>
        </div>

        <div class="panel">
          <p class="mono-label mono-label--hot">Инвайты</p>
          ${queue.invites() ? `
            <p class="body-muted" style="margin-top:.6rem">У тебя ${queue.invites()} ${pluralize(queue.invites(), ['инвайт', 'инвайта', 'инвайтов'])}. Отдай тому, кто реально носит.</p>
            <div class="stack stack--sm" style="margin-top:.85rem">
              ${Array.from({ length: queue.invites() }, (_, i) => `
                <div class="row row--between" style="border:1px solid var(--ash-line);padding:.6rem .8rem">
                  <span class="mono-label">${esc(code)}-${String(i + 1).padStart(2, '0')}</span>
                  <button class="remove-x" type="button" data-copy-invite="${esc(code)}-${String(i + 1).padStart(2, '0')}">Скопировать</button>
                </div>`).join('')}
            </div>` : `<p class="body-muted" style="margin-top:.6rem">Пока нет. Ещё ${nextInvite} ${pluralize(nextInvite, ['друг', 'друга', 'друзей'])} — и появится.</p>`}
        </div>
      </div>`;
  };

  const panelSettings = () => {
    const u = user.get();
    const n = notif.get();
    return `
      <div class="split">
        <div class="stack stack--lg">
          <div class="panel stack">
            <p class="mono-label mono-label--hot">Уведомления</p>
            <label class="switch" style="margin-top:.5rem">
              <input type="checkbox" data-notif-email ${n.email ? 'checked' : ''}>
              <span class="switch__track" aria-hidden="true"></span>
              <span>Письмо за час до дропа</span>
            </label>
            <label class="switch">
              <input type="checkbox" data-notif-push ${n.push ? 'checked' : ''}>
              <span class="switch__track" aria-hidden="true"></span>
              <span>Пуш-уведомление в браузере</span>
            </label>
            <p class="field__hint">Один сигнал за час. Никаких «последний шанс» и «горячих предложений».</p>
          </div>

          <div class="panel stack">
            <p class="mono-label mono-label--hot">Данные</p>
            <label class="field">
              <span class="field__label">Имя</span>
              <input class="input" type="text" value="${esc(u?.name || '')}" data-name-input placeholder="как обращаться">
            </label>
            <label class="field">
              <span class="field__label">Почта</span>
              <input class="input" type="email" value="${esc(u?.email || '')}" readonly>
              <span class="field__hint">Почта — это твой ключ. Менять её нельзя.</span>
            </label>
            <button class="btn btn--sm" type="button" data-save-name>Сохранить</button>
          </div>
        </div>

        <div class="stack stack--lg">
          <div class="panel stack">
            <p class="mono-label mono-label--hot">Система</p>
            <dl class="kv" style="margin-top:.5rem">
              <dt>Класс доступа</dt><dd>${esc(queue.access().label)}</dd>
              <dt>В очереди с</dt><dd>${queue.entry() ? esc(dt(queue.entry().at)) : '—'}</dd>
              <dt>Заказов</dt><dd>${ordersState.remote.length || orders.count()}</dd>
              <dt>В вишлисте</dt><dd>${wishlist.count()}</dd>
              <dt>В корзине</dt><dd>${cart.count()}</dd>
            </dl>
          </div>

          <div class="panel stack">
            <p class="mono-label mono-label--hot">Данные хранятся локально</p>
            <p class="body-muted" style="font-size:var(--step--1)">
              Это витрина: корзина, очередь и заказы живут в твоём браузере. Ничего никуда не уходит —
              даже карта. Сбросишь данные — начнёшь заново.
            </p>
            <div class="row row--wrap">
              <button class="btn btn--ghost btn--sm" type="button" data-reset>Сбросить всё</button>
            </div>
          </div>
        </div>
      </div>`;
  };

  /* ── отрисовка ── */

  const PANELS = {
    orders: panelOrders,
    wishlist: panelWishlist,
    drop: panelDrop,
    referral: panelReferral,
    settings: panelSettings,
  };

  /**
   * Спросить заказы у сервера. Код последнего заказа берём из памяти: без него
   * сервер отдаёт только сводку, чтобы чужой человек по одной почте не увидел
   * все покупки.
   */
  const loadOrders = async () => {
    const email = user.get()?.email;
    if (!email) return;
    ordersState.loading = true;
    ordersState.error = null;
    paint();
    try {
      const data = await listOrders(email, { code: ordersState.code });
      ordersState.remote = data.orders || [];
      ordersState.verifiedBy = data.verifiedBy || 'none';
      ordersState.needCode = !!data.requiresCode;
      ordersState.count = data.orders?.length || 0;
      orders.cache(ordersState.remote);
      ordersState.error = null;
    } catch (err) {
      ordersState.error = err.message || 'Не удалось получить заказы';
      ordersState.remote = [];
    } finally {
      ordersState.loading = false;
      ordersState.loaded = true;
      paint();
    }
  };

  const paint = () => {
    drawAuth();
    if (lead) {
      lead.textContent = queue.entry()
        ? `Ты в очереди с позицией ${queue.position()}. Класс доступа: ${queue.access().label}.`
        : 'Система помнит, что ты купил, что отложил и когда заходишь.';
    }

    host.innerHTML = `
      <div class="tabs" role="tablist" aria-label="Разделы кабинета">
        ${TABS.map((t) => `<button class="tab" role="tab" data-tab="${t.id}"
           aria-selected="${t.id === active}" aria-controls="panel-${t.id}">${esc(t.label)}</button>`).join('')}
      </div>
      <div style="margin-top:clamp(1.25rem,3vw,2rem)">
        ${TABS.map((t) => `<section class="tabpanel" id="panel-${t.id}" role="tabpanel" data-panel="${t.id}" ${t.id === active ? '' : 'hidden'}>
          ${t.id === active ? PANELS[t.id]() : ''}
        </section>`).join('')}
      </div>`;

    $$('[data-tab]', host).forEach((btn) => btn.addEventListener('click', () => {
      active = btn.dataset.tab;
      history.replaceState(null, '', `#${active}`);
      paint();
    }));

    if (active === 'orders' && user.signedIn() && !ordersState.loaded && !ordersState.loading) {
      loadOrders();
    }

    wire();
    initReveal(host);

    const cdHost = $('[data-countdown]', host);
    if (cdHost) mountCountdown(cdHost, CURRENT_DROP.date);
  };

  /* ── обработчики активной панели ── */
  const wire = () => {
    const u = user.get();

    /* заказы с сервера */
    $('[data-orders-retry]', host)?.addEventListener('click', () => loadOrders());
    $('[data-order-code]', host)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = e.target.elements.code.value.trim().toUpperCase();
      if (!code) return;
      ordersState.code = code;
      ordersState.loaded = false;
      await loadOrders();
      if (!ordersState.remote.length) {
        const box = $('[data-code-error]', host);
        if (box) {
          box.hidden = false;
          box.textContent = 'Такого номера на эту почту нет. Проверь письмо.';
        }
      }
    });
    $$('[data-sync]', host).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      b.innerHTML = '<span class="spinner"></span> проверяем';
      try {
        const fresh = await syncOrder(b.dataset.sync);
        toast(
          fresh.status === 'paid' ? 'Оплата подтверждена' : 'Статус обновлён',
          `${fresh.statusLabel}. ${fresh.statusNote}`,
          4200,
        );
        await loadOrders();
      } catch (err) {
        b.disabled = false;
        b.textContent = 'Проверить оплату';
        toast('Не получилось', err.message, 4000);
      }
    }));

    /* вишлист: сеткой */
    const wg = $('[data-wishlist-grid]', host);
    if (wg) wg.append(productGrid(wishlist.products()));

    /* заказы */
    $$('[data-repeat]', host).forEach((b) => b.addEventListener('click', () => {
      const list = ordersState.remote.length ? ordersState.remote : orders.cached();
      const o = list.find((x) => x.number === b.dataset.repeat);
      if (!o) return;
      let added = 0;
      o.items.forEach((i) => {
        const p = productById(i.id);
        if (!p) return;
        const size = i.size && p.sizes?.[i.size] > 0 ? i.size : (p.sizes ? Object.keys(p.sizes).find((s) => p.sizes[s] > 0) : null);
        if (cart.add(i.id, size, i.qty)) added++;
      });
      toast(added ? 'В корзине' : 'Не вышло', added
        ? `${added} ${pluralize(added, ['позиция', 'позиции', 'позиций'])} добавлено — проверь размеры.`
        : 'Размеров уже нет. Распродано.', 4200);
    }));

    $$('[data-receipt]', host).forEach((b) => b.addEventListener('click', () => {
      const list = ordersState.remote.length ? ordersState.remote : orders.cached();
      const o = list.find((x) => x.number === b.dataset.receipt);
      if (!o) return;
      const lines = [
        `ASHEN · чек ${o.number}`,
        new Date(o.at).toLocaleString('ru-RU'),
        '',
        ...o.items.map((i) => `${i.name}${i.size ? ` (${i.size})` : ''} × ${i.qty} — ${money(i.sum)}`),
        '',
        `Товары: ${money(o.sum)}`,
        `Доставка: ${o.shipping ? money(o.shipping) : 'бесплатно'}`,
        o.discount ? `Скидка: −${money(o.discount)}` : '',
        `Итого: ${money(o.total)}`,
      ].filter(Boolean).join('\n');
      const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${o.number}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Чек сохранён', 'Текстовый файл. Бумажный — по запросу.', 3000);
    }));

    /* реферал */
    $('[data-copy-link]', host)?.addEventListener('click', async () => {
      const link = queue.referralLink();
      try { await navigator.clipboard.writeText(link); toast('Скопировано', 'Кидай своим. Они зайдут раньше.', 3000); }
      catch { toast('Скопируй вручную', link, 6000); }
    });
    $('[data-share-link]', host)?.addEventListener('click', async () => {
      const link = queue.referralLink();
      const text = `Дроп ${String(CURRENT_DROP.n).padStart(2, '0')}: ${CURRENT_DROP.code}. Свои заходят первыми. ${link}`;
      try {
        if (navigator.share) await navigator.share({ title: 'ASHEN', text });
        else { await navigator.clipboard.writeText(text); toast('Скопировано', 'Вставь в телегу.', 3000); }
      } catch { /* отменили */ }
    });
    $('[data-demo-friend]', host)?.addEventListener('click', () => {
      queue.addFriend();
      const f = queue.entry().friends;
      toast('Друг в системе', `Приведено: ${f}. Позиция: ${queue.position()}.`, 3600);
      paint();
    });
    $$('[data-copy-invite]', host).forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copyInvite); toast('Инвайт скопирован', b.dataset.copyInvite, 3000); }
      catch { toast('Инвайт', b.dataset.copyInvite, 5000); }
    }));

    /* настройки */
    $('[data-notif-email]', host)?.addEventListener('change', () => { notif.toggleEmail(); toast('Ок', 'Письмо за час до дропа — как скажешь.', 2400); });
    $('[data-notif-push]', host)?.addEventListener('change', async () => {
      const n = notif.togglePush();
      toast(n.push ? 'Пуши включены' : 'Пуши выключены', n.push ? 'Разреши уведомления в браузере, и не пропустишь.' : '', 3200);
    });
    $('[data-save-name]', host)?.addEventListener('click', () => {
      user.rename($('[data-name-input]', host).value.trim());
      toast('Сохранено', 'Теперь обращаемся по имени.', 2400);
      paint();
    });
    $('[data-reset]', host)?.addEventListener('click', () => {
      safeStore.del('ashen.state.v1');
      safeStore.del('ashen.booted');
      try { sessionStorage.clear(); } catch { /* тихо */ }
      toast('Сброшено', 'Система забыла всё. Начнём заново.', 2600);
      setTimeout(() => location.reload(), 900);
    });

    void u;
  };

  paint();
  store.on(() => { /* общий слой сам обновляет бейджи */ });

  /* hash-навигация внутри страницы не перезапускает модуль — ловим её сами */
  addEventListener('hashchange', () => {
    const next = tabFromHash();
    if (next === active) return;
    active = next;
    paint();
    if (active === 'orders' && user.signedIn() && !ordersState.loaded) loadOrders();
  });

  /* Заказы грузим сразу, если уже вошли: вкладка «Заказы» открыта по умолчанию. */
  if (user.signedIn() && active === 'orders') loadOrders();
}
