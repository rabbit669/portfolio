/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — медиа
   Лукбуки, плейлисты, интервью, гайды. Архив системы.
   ═══════════════════════════════════════════════════════════════════════════ */

import { POSTS, CURRENT_DROP } from '../data.js';
import { user, queue } from '../store.js';
import { $, $$, el, esc, initReveal } from '../util.js';
import { toast } from '../ui.js';

const TAGS = [
  { id: 'all', label: 'Всё' },
  { id: 'лукбук', label: 'Лукбуки' },
  { id: 'плейлист', label: 'Плейлисты' },
  { id: 'интервью', label: 'Интервью' },
  { id: 'гайд', label: 'Гайды' },
];

export default async function media() {
  const host = $('[data-posts]');
  const tabs = $('[data-media-tabs]');
  if (!host) return;

  let tag = 'all';

  const paint = () => {
    const list = POSTS.filter((p) => tag === 'all' || p.tag === tag);
    host.innerHTML = list.map((p, i) => `
      <article class="post" data-reveal style="--d:${i * 60}ms">
        <div class="stack">
          <p class="mono-label mono-label--hot">${esc(p.tag)} · ${esc(p.date)}</p>
          <h2 class="t-sm display" style="margin-top:.25rem">${esc(p.title)}</h2>
          <p class="serif" style="font-size:var(--step-1);max-width:46ch">${esc(p.lead)}</p>
          <p class="body-muted measure" style="font-size:var(--step--1)">${esc(p.body)}</p>
          <div class="row row--wrap">
            <button class="btn btn--sm" type="button" data-open-post="${esc(p.id)}">Читать целиком</button>
            <a class="link-underline" href="catalog.html?drop=${esc(CURRENT_DROP.id)}">Вещи из съёмки</a>
          </div>
        </div>
        <figure class="post__media">
          <img src="${esc(p.img)}" alt="${esc(p.title)}" width="1440" height="900" loading="lazy">
        </figure>
      </article>`).join('');

    if (!list.length) host.innerHTML = '<p class="body-muted">В этом разделе пока пусто. Пишем.</p>';
    initReveal(host);

    $$('[data-open-post]', host).forEach((b) => b.addEventListener('click', () => open(b.dataset.openPost)));
  };

  if (tabs) {
    tabs.innerHTML = TAGS.map((t) => `<button class="chip${t.id === tag ? ' is-active' : ''}" type="button" data-tag="${t.id}">${esc(t.label)}</button>`).join('');
    $$('[data-tag]', tabs).forEach((b) => b.addEventListener('click', () => {
      tag = b.dataset.tag;
      $$('[data-tag]', tabs).forEach((x) => x.classList.toggle('is-active', x === b));
      paint();
    }));
  }

  /* ── читалка ── */
  function open(id) {
    const post = POSTS.find((p) => p.id === id);
    if (!post) return;
    const overlay = el('div', {
      class: 'reader',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': post.title,
    });
    overlay.innerHTML = `
      <div class="reader__panel">
        <header class="row row--between" style="padding:1rem var(--pad);border-bottom:1px solid var(--ash-line)">
          <span class="mono-label mono-label--hot">${esc(post.tag)} · ${esc(post.date)}</span>
          <button class="icon-btn" type="button" data-close aria-label="Закрыть">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </header>
        <div class="reader__body">
          <img src="${esc(post.img)}" alt="" width="1440" height="900" style="width:100%;border:1px solid var(--ash-line)">
          <h2 class="t-md" style="margin-top:1.5rem">${esc(post.title)}</h2>
          <p class="serif" style="font-size:var(--step-2);margin-top:.75rem">${esc(post.lead)}</p>
          <p class="body-muted" style="margin-top:1rem">${esc(post.body)}</p>
          <p class="body-muted" style="margin-top:1rem">
            Съёмка: тёмная студия, один жёсткий источник, фиолетовый неон как акцент. Позы — отстранённость,
            взгляд в сторону. Никаких улыбок: это не реклама, это система.
          </p>
          <div class="row row--wrap" style="margin-top:1.5rem">
            <a class="btn btn--sm btn--violet" href="waitlist.html">Встать в очередь на дроп</a>
            <a class="link-underline" href="catalog.html">Смотреть вещи</a>
          </div>
        </div>
      </div>`;
    document.body.append(overlay);
    document.body.classList.add('is-locked');
    requestAnimationFrame(() => overlay.classList.add('is-open'));

    const close = () => {
      overlay.classList.remove('is-open');
      document.body.classList.remove('is-locked');
      setTimeout(() => overlay.remove(), 300);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
  }

  /* ── кнопки ── */
  $('[data-playlist-open]')?.addEventListener('click', (e) => {
    e.preventDefault();
    toast('Плейлист ASHEN / 011', 'Открывается в Telegram-канале. 43 минуты, 12 треков.', 4200);
  });
  $('[data-subscribe]')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!queue.entry()) {
      queue.join({ email: user.get()?.email || '' });
      toast('Ты в очереди', `Позиция ${queue.position()}. Анонс придёт за час.`, 4200);
    } else {
      toast('Уже подписан', 'Один сигнал за час до дропа. Больше не пишем.', 3600);
    }
  });

  paint();
}
