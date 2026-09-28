/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — комьюнити
   Лента, чат «свои», UGC, соцсети. Здесь тише, чем в телеге.
   ═══════════════════════════════════════════════════════════════════════════ */

import { FEED, UGC, CHAT_SEED, BRAND, CURRENT_DROP } from '../data.js';
import { user, queue, store } from '../store.js';
import { $, $$, el, esc, safeStore, initReveal, sleep } from '../util.js';
import { toast, ugcRail } from '../ui.js';

const CHAT_KEY = 'ashen.chat.v1';
const nf = new Intl.NumberFormat('ru-RU');

/* живые ответы «системы» — чтобы чат не выглядел мёртвым */
const REPLIES = [
  'база. беру.',
  'у меня в размер село, если что',
  'кто-нибудь брал зеркалку? как она в живую?',
  'обсидиан чёрный настолько, что на фото серый. смешно',
  'в пятницу беру пальто. кто со мной в очередь?',
  'рефералка работает, я поднялся на 1200',
  'кринж только в том, что тираж маленький',
  'лист ожидания в шапке, если что',
];
const WHO = ['@nkvl', '@sonya', '@dvrk', '@lens.exe', '@kirill_4', '@velvet', '@morozzz', '@a.vshn'];

export default async function community() {
  const host = $('[data-community]');
  if (!host) return;

  /* ── лента ── */
  const feedHtml = FEED.map((f, i) => `
    <article class="feed__item" data-reveal style="--d:${i * 55}ms">
      <span class="feed__kind">${esc(f.kind)}</span>
      <div>
        <h3 class="feed__title">${esc(f.title)}</h3>
        <p class="feed__body">${esc(f.body)}</p>
        <a class="link-underline" href="${esc(f.cta.href)}" style="margin-top:.6rem">${esc(f.cta.label)} →</a>
      </div>
      <span class="feed__time">${esc(f.time)}</span>
    </article>`).join('');

  const online = 1200 + Math.floor(Math.random() * 400);
  const onlineHost = $('[data-community-online]');
  if (onlineHost) onlineHost.textContent = `${nf.format(online)} в системе сейчас`;

  host.className = 'community-layout';
  host.innerHTML = `
    <div class="stack stack--lg">
      <div>
        <div class="section-head" style="margin-bottom:1rem">
          <div>
            <p class="mono-label mono-label--hot">Лента апдейтов</p>
            <h2 class="t-sm display" style="margin-top:.35rem">ЧТО ПРОИСХОДИТ</h2>
          </div>
        </div>
        <div class="feed" data-feed-page>${feedHtml}</div>
      </div>

      <div class="panel stack" data-feed-compose>
        <p class="mono-label mono-label--hot">Сказать своё</p>
        <p class="body-muted" style="font-size:var(--step--1)">
          Апдейты пишем мы. Но фото, луки и «в размер или нет» — только вы. Кидай в чат справа.
        </p>
        <div class="row row--wrap">
          <button class="btn btn--sm" type="button" data-ugc-send>Прислать фото</button>
          <a class="link-underline" href="${esc(BRAND.socials[0].url)}" target="_blank" rel="noopener">Написать в Telegram</a>
        </div>
      </div>
    </div>

    <aside class="stack stack--lg">
      <div class="chat" data-chat>
        <header class="chat__head">
          <span class="mono-label mono-label--hot">Чат · свои</span>
          <span class="status status--live">${nf.format(Math.floor(online / 5))} онлайн</span>
        </header>
        <div class="chat__log" data-chat-log aria-live="polite"></div>
        <form class="chat__form" data-chat-form>
          <input class="input" type="text" name="text" placeholder="написать…" maxlength="240" aria-label="Сообщение">
          <button class="btn btn--sm" type="submit">→</button>
        </form>
      </div>

      <div class="panel stack">
        <p class="mono-label mono-label--hot">Сигнал в соцсетях</p>
        <div class="stack stack--sm" style="margin-top:.35rem">
          ${BRAND.socials.map((s) => `
            <a class="row row--between" href="${esc(s.url)}" target="_blank" rel="noopener"
               style="border:1px solid var(--ash-line);padding:.7rem .85rem">
              <span class="product__name" style="font-size:.72rem">${esc(s.name)}</span>
              <span class="mono-label">${esc(s.handle)}</span>
            </a>`).join('')}
        </div>
        <p class="field__hint">В телеге — анонсы. В VK — альбомы и опросы. В TikTok — распаковки под тёмный бит.</p>
      </div>

      <div class="panel stack">
        <p class="mono-label mono-label--hot">Ближайший дроп</p>
        <p class="t-xs display">${String(CURRENT_DROP.n).padStart(2, '0')} · ${esc(CURRENT_DROP.code)}</p>
        <p class="field__hint">${esc(CURRENT_DROP.thesis)}</p>
        <a class="btn btn--sm btn--violet" href="waitlist.html">Встать в очередь</a>
      </div>
    </aside>`;

  /* ── UGC ── */
  const ugcHost = $('[data-ugc-full]');
  if (ugcHost) ugcHost.replaceWith(ugcRail(UGC, { limit: 8 }));

  /* ── чат ── */
  const log = $('[data-chat-log]', host);
  let messages = safeStore.get(CHAT_KEY, null);
  if (!Array.isArray(messages) || !messages.length) {
    messages = CHAT_SEED.map((m) => {
      const hh = String(m.t).split(':')[0];
      return { ...m, at: Date.now() - (20 - Number(hh)) * 60_000 };
    });
    safeStore.set(CHAT_KEY, messages);
  }

  const renderChat = () => {
    if (!log) return;
    const me = user.get();
    log.innerHTML = messages.slice(-60).map((m) => {
      const mine = me && m.who === (me.name || me.email);
      return `
        <div class="chat__msg${mine ? ' chat__msg--me' : ''}">
          <span class="chat__who">${esc(m.who)}${mine ? ' · ты' : ''}</span>
          <span class="chat__bubble">${esc(m.text)}</span>
        </div>`;
    }).join('');
    log.scrollTop = log.scrollHeight;
  };
  renderChat();

  $('[data-chat-form]', host)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.elements.text;
    const text = input.value.trim();
    if (!text) return;

    const me = user.get();
    const who = me ? (me.name || me.email) : 'гость';
    messages.push({ who, text, at: Date.now(), me: true });
    safeStore.set(CHAT_KEY, messages);
    input.value = '';
    renderChat();

    /* «кто-то ответил» — с задержкой, как в живом чате */
    await sleep(900 + Math.random() * 1200);
    const reply = {
      who: WHO[(Math.random() * WHO.length) | 0],
      text: REPLIES[(Math.random() * REPLIES.length) | 0],
      at: Date.now(),
      me: false,
    };
    messages.push(reply);
    safeStore.set(CHAT_KEY, messages);
    renderChat();
  });

  /* ── «прислать фото» ── */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ugc-send]');
    if (!b) return;
    e.preventDefault();
    toast('Кидай в телегу', 'Отмечай @ashen — заберём в ленту. Лучшие попадают в подборку дропа.', 5200);
  });

  /* ── подписка ── */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-subscribe]');
    if (!b) return;
    e.preventDefault();
    if (!queue.entry()) {
      queue.join({ email: user.get()?.email || '' });
      toast('Ты в очереди', `Позиция ${queue.position()}. Анонсы — в телеге и на почту.`, 4200);
    } else {
      toast('Уже внутри', `Позиция ${queue.position()}. Один сигнал за час до дропа.`, 3600);
    }
  });

  initReveal();
  store.on(() => { /* ничего: чат живёт сам */ });
}
