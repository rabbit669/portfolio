/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — главная
   Таймер, капсула недели, очередь, лента, UGC, соцсети.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  BRAND, CURRENT_DROP, DROPS, FEED, UGC, QUEUE_GOAL, productsOfDrop, totalStock,
} from '../data.js';
import { queue, store, notif } from '../store.js';
import { $, $$, esc, glitchText, onIntersect, sleep } from '../util.js';
import { mountCountdown, productGrid, ugcRail, toast, accessLine } from '../ui.js';

const nf = new Intl.NumberFormat('ru-RU');

export default async function home() {
  /* ── таймер ── */
  const cd = $('[data-countdown]');
  mountCountdown(cd, CURRENT_DROP.date, {
    onDone: () => {
      const status = $('[data-drop-status]');
      if (status) { status.className = 'status status--live'; status.textContent = 'дроп открыт · свои уже внутри'; }
      toast('Дроп открыт', 'Свои заходят первыми. Остальные — через 30 минут.', 6000);
    },
  });

  const refresh = () => {
    const line = accessLine();
    const node = $('[data-access-line]');
    if (node) {
      node.textContent = line.text;
      node.classList.toggle('mono-label--hot', line.hot);
    }

    const size = queue.size();
    $('[data-queue-count]').textContent = nf.format(size);
    $('[data-queue-bar]').style.width = `${Math.min(100, (size / QUEUE_GOAL) * 100).toFixed(1)}%`;
    const left = Math.max(0, QUEUE_GOAL - size);
    const note = $('[data-queue-note]');
    if (note) {
      note.textContent = queue.entry()
        ? `Ты внутри. Позиция ${queue.position()} — реферал двигает вверх. До цели ${nf.format(left)} человек.`
        : `Встань в очередь. Свои заходят первыми. До цели ${nf.format(left)} человек.`;
    }

    const items = productsOfDrop(CURRENT_DROP.id);
    const left8 = items.reduce((n, p) => n + totalStock(p), 0);
    const cap = $('[data-capsule-left]');
    if (cap) cap.textContent = left8 > 0 ? `в наличии ${left8} позиций` : 'распродано';
  };
  refresh();
  store.on(refresh);

  /* ── капсула недели ── */
  const grid = $('[data-capsule-grid]');
  if (grid) {
    const items = productsOfDrop(CURRENT_DROP.id);
    grid.replaceWith(productGrid(items));
  }

  /* ── заголовок: глитч при первой отрисовке ── */
  const title = $('[data-glitch-title]');
  if (title) {
    const g = glitchText(title, title.textContent.replace(/\s+/g, ' ').trim());
    document.addEventListener('ashen:booted', () => g.start(620), { once: true });
  }

  /* ── лента комьюнити ── */
  const feed = $('[data-feed]');
  if (feed) {
    feed.innerHTML = FEED.map((f, i) => `
      <article class="feed__item" data-reveal style="--d:${i * 60}ms">
        <span class="feed__kind">${esc(f.kind)}</span>
        <div>
          <h3 class="feed__title">${esc(f.title)}</h3>
          <p class="feed__body">${esc(f.body)}</p>
          <a class="link-underline" href="${esc(f.cta.href)}" style="margin-top:.6rem">${esc(f.cta.label)} →</a>
        </div>
        <span class="feed__time">${esc(f.time)}</span>
      </article>`).join('');
  }

  /* ── UGC ── */
  const ugcHost = $('[data-ugc]');
  if (ugcHost) ugcHost.replaceWith(ugcRail(UGC, { limit: 8 }));

  /* ── соцсети ── */
  const socials = $('[data-socials]');
  if (socials) {
    const icons = {
      telegram: '<svg viewBox="0 0 24 24"><path d="M21 5L3 11.5l5 1.8L19 7l-8.5 8.2.3 4.3L14 16l5-11"/></svg>',
      vk: '<svg viewBox="0 0 24 24"><path d="M4 7c.6 4.6 3.2 8 7.2 8h1.4v-3.1c1.6.7 2.6 2.1 3.1 3.1H19c-.5-1.7-1.7-3.4-3.2-4.3 1.3-1 2.3-2.4 2.7-4h-3c-.4 1.4-1.3 2.7-2.9 3.2V6.7h-1.5v4c-1.6-.7-3-2.6-3.3-4H4Z"/></svg>',
      tiktok: '<svg viewBox="0 0 24 24"><path d="M14 4v9.5a3.5 3.5 0 1 1-3-3.46"/><path d="M14 5.5c.7 1.9 2.2 3 4 3.2"/></svg>',
    };
    socials.innerHTML = BRAND.socials.map((s, i) => `
      <a class="social-tile" href="${esc(s.url)}" target="_blank" rel="noopener" data-reveal style="--d:${i * 70}ms">
        ${icons[s.id] || ''}
        <span class="social-tile__name">${esc(s.name)}</span>
        <span class="social-tile__note">${esc(s.note)}</span>
        <span class="mono-label">${esc(s.handle)}</span>
      </a>`).join('');
  }

  /* ── форма очереди ── */
  const form = $('[data-waitlist-form]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.elements.email;
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      input.classList.add('is-bad');
      toast('Почта не та', 'Проверь адрес — сигнал должен дойти.');
      input.focus();
      return;
    }
    input.classList.remove('is-bad');

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Добавляем…';
    await sleep(700);

    const entry = queue.join({ email });
    if (form.elements.push?.checked && !notif.get().push) notif.togglePush();

    btn.textContent = 'Ты в очереди';
    btn.classList.add('btn--violet');
    toast('Доступ разрешён', `Позиция ${queue.position()} из ${nf.format(queue.size())}.`, 5200);

    const note = $('[data-queue-note]');
    if (note) note.innerHTML = `Ты внутри. Позиция <strong>${queue.position()}</strong>. ` +
      `Приведи друга — поднимешься на 400 позиций. <a class="link-underline" href="account.html#referral">Инвайты</a>`;
    refresh();
  });

  /* ── подписи дропов (бегущая строка уже статична) ── */
  const marquee = $('.marquee__track');
  if (marquee) {
    const items = [...DROPS, ...DROPS];
    marquee.innerHTML = items.map((d) => `<span class="marquee__item">${esc(d.code)}</span>`).join('');
  }

  /* ── мягкое появление секций ── */
  onIntersect($$('[data-reveal]').filter((n) => !n.classList.contains('is-in')),
    (n) => n.classList.add('is-in'));
}
