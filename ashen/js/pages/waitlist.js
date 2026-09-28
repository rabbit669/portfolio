/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — лист ожидания
   Почта, пуш, позиция в очереди, рефералка и инвайты.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  CURRENT_DROP, QUEUE_GOAL, PERKS, REFERRAL_REWARD, fmtDate, fmtWeekday, fmtTime,
} from '../data.js';
import { queue, user, notif, store, summary } from '../store.js';
import { $, $$, esc, money, initReveal, sleep } from '../util.js';
import { mountCountdown, toast } from '../ui.js';

const nf = new Intl.NumberFormat('ru-RU');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function waitlist() {
  const host = $('[data-waitlist-inner]');
  const referralBox = $('[data-referral-box]');
  const stats = $('[data-queue-stats]');
  const perks = $('[data-perks]');

  if (!host) return;

  /* ── таймер ── */
  mountCountdown($('[data-countdown]'), CURRENT_DROP.date, {
    onDone: () => toast('Дроп открыт', 'Свои уже внутри. Очередь подтягивается.', 6000),
  });

  /* ── что даёт очередь ── */
  if (perks) {
    perks.innerHTML = PERKS.map((p) => `
      <li><strong style="color:var(--white)">${esc(p.title)}.</strong> ${esc(p.note)}</li>`).join('');
  }

  /* ── форма или карточка участника ── */
  const paint = () => {
    const entry = queue.entry();

    if (!entry) {
      host.innerHTML = `
        <form class="stack" data-waitlist data-waitlist-form novalidate>
          <p class="mono-label mono-label--hot">Лист ожидания · дроп ${String(CURRENT_DROP.n).padStart(2, '0')}: ${esc(CURRENT_DROP.code)}</p>
          <p class="t-xs display" style="margin:.35rem 0">ВСТАНЬ В ОЧЕРЕДЬ</p>
          <p class="serif">Свои заходят первыми. ${esc(fmtWeekday(CURRENT_DROP.date))}, ${esc(fmtDate(CURRENT_DROP.date))}, ${esc(fmtTime(CURRENT_DROP.date))}.</p>

          <label class="field">
            <span class="field__label">Почта *</span>
            <input class="input" type="email" name="email" placeholder="you@mail.ru" autocomplete="email" required>
          </label>
          <label class="field">
            <span class="field__label">Имя (по желанию)</span>
            <input class="input" type="text" name="name" placeholder="как обращаться" autocomplete="given-name">
          </label>
          <label class="switch">
            <input type="checkbox" name="push" checked>
            <span class="switch__track" aria-hidden="true"></span>
            <span>Пуш и письмо за час до дропа</span>
          </label>
          <button class="btn btn--solid btn--block btn--lg" type="submit">Встать в очередь</button>
          <p class="field__hint">Один сигнал. Отписаться можно в один клик, без угрызений совести.</p>
        </form>`;
      wireForm();
      return;
    }

    const pos = queue.position();
    const size = queue.size();
    const pct = Math.min(100, (size / QUEUE_GOAL) * 100);
    const access = queue.access();
    const link = queue.referralLink();

    host.innerHTML = `
      <div class="stack" data-granted>
        <p class="access-granted t-sm">ACCESS GRANTED</p>
        <p class="mono-label mono-label--hot">Ты в системе · ${esc(entry.email || user.get()?.email || '')}</p>

        <div class="stat-row" style="margin-top:.5rem">
          <div class="stat"><span class="stat__val" data-my-position>${nf.format(pos)}</span><span class="stat__label">твоя позиция</span></div>
          <div class="stat"><span class="stat__val">${nf.format(size)}</span><span class="stat__label">всего в очереди</span></div>
          <div class="stat"><span class="stat__val">${entry.friends || 0}</span><span class="stat__label">друзей привёл</span></div>
          <div class="stat"><span class="stat__val">${queue.invites()}</span><span class="stat__label">инвайтов</span></div>
        </div>

        <div class="stack stack--sm" style="margin-top:.75rem">
          <div class="row row--between">
            <span class="mono-label">До цели ${nf.format(QUEUE_GOAL)}</span>
            <span class="mono-label">${pct.toFixed(1)}%</span>
          </div>
          <div class="progress"><span style="width:${pct.toFixed(1)}%"></span></div>
          <p class="field__hint">
            Осталось ${nf.format(Math.max(0, QUEUE_GOAL - size))} человек. Номер в очереди живой — он двигается вниз, когда кто-то заходит.
          </p>
        </div>

        <div class="stack stack--sm" style="margin-top:.75rem">
          <p class="mono-label">Твой класс доступа</p>
          <p class="t-xs display">${esc(access.label)}</p>
          <p class="field__hint">
            ${access.lead
              ? `Дроп открывается для тебя на ${access.lead} ч раньше открытой очереди.`
              : `Пока как все — в ${esc(fmtTime(CURRENT_DROP.date))}. Приведи друга: каждый поднимает тебя на ${REFERRAL_REWARD.perFriend} позиций.`}
          </p>
        </div>

        <div class="stack stack--sm" style="margin-top:.75rem">
          <label class="field">
            <span class="field__label">Ссылка для своих</span>
            <input class="input" type="text" readonly value="${esc(link || '')}" data-referral-link aria-label="Реферальная ссылка">
          </label>
          <div class="row row--wrap">
            <button class="btn btn--sm" type="button" data-copy>Скопировать</button>
            <a class="btn btn--ghost btn--sm" href="account.html#referral">Инвайты в кабинете</a>
          </div>
        </div>
      </div>`;

    $('[data-copy]', host)?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); toast('Скопировано', 'Кидай своим — они зайдут раньше.', 3000); }
      catch { toast('Ссылка', link, 6000); }
    });
  };

  /* ── отправка формы ── */
  function wireForm() {
    $('[data-waitlist-form]', host)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const email = form.elements.email.value.trim();
      const name = form.elements.name.value.trim();

      if (!EMAIL_RE.test(email)) {
        form.elements.email.classList.add('is-bad');
        toast('Почта не та', 'Проверь адрес — сигнал должен дойти.');
        form.elements.email.focus();
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Проверяем доступ…';
      await sleep(900);

      const entry = queue.join({ email, name });
      if (form.elements.push?.checked) {
        if (!notif.get().push) notif.togglePush();
        if (!user.signedIn()) user.signIn({ email, name });
      }

      toast('Доступ разрешён', `Позиция ${nf.format(queue.position())} из ${nf.format(queue.size())}.`, 5200);
      paint();
      paintReferral();
      paintStats();
    });
  }

  /* ── реферальный блок ── */
  function paintReferral() {
    if (!referralBox) return;
    const entry = queue.entry();
    if (!entry) {
      referralBox.innerHTML = `
        <p class="mono-label mono-label--hot">Приведи друга</p>
        <p class="body-muted" style="margin-top:.6rem;font-size:var(--step--1)">
          Рефералка включится вместе с очередью. Каждый друг поднимает тебя на ${REFERRAL_REWARD.perFriend} позиций,
          а он сам заходит на ${REFERRAL_REWARD.inviteLeadHours} ч раньше.
        </p>`;
      return;
    }
    const friends = entry.friends || 0;
    referralBox.innerHTML = `
      <p class="mono-label mono-label--hot">Приведи друга — зайдёшь раньше</p>
      <p class="t-xs display" style="margin:.4rem 0">+${REFERRAL_REWARD.perFriend} ПОЗИЦИЙ<br>ЗА КАЖДОГО</p>
      <div class="stack stack--sm">
        <div class="summary-row"><span class="muted">Друзей по ссылке</span><span class="price">${friends}</span></div>
        <div class="summary-row"><span class="muted">Инвайтов на руках</span><span class="price">${queue.invites()}</span></div>
        <div class="summary-row"><span class="muted">Твоя позиция</span><span class="price">${nf.format(queue.position())}</span></div>
      </div>
      <div class="row row--wrap" style="margin-top:.6rem">
        <button class="btn btn--violet btn--sm" type="button" data-demo-friend>Имитировать друга</button>
        <a class="link-underline" href="account.html#referral">Все инвайты</a>
      </div>`;
    $('[data-demo-friend]', referralBox)?.addEventListener('click', () => {
      queue.addFriend();
      toast('Друг внутри', `Приведено: ${queue.entry().friends}. Позиция: ${nf.format(queue.position())}.`, 3600);
      paint();
      paintReferral();
      paintStats();
    });
  }

  /* ── статистика очереди ── */
  function paintStats() {
    if (!stats) return;
    const s = summary();
    const size = s.queueSize;
    stats.innerHTML = `
      <div class="stat panel"><span class="stat__val">${nf.format(size)}</span><span class="stat__label">в очереди сейчас</span></div>
      <div class="stat panel"><span class="stat__val">${nf.format(QUEUE_GOAL)}</span><span class="stat__label">цель до дропа</span></div>
      <div class="stat panel"><span class="stat__val">${s.position ? nf.format(s.position) : '—'}</span><span class="stat__label">твоя позиция</span></div>
      <div class="stat panel"><span class="stat__val">${s.friends}</span><span class="stat__label">друзей привёл</span></div>`;
  }

  paint();
  paintReferral();
  paintStats();

  store.on(() => { /* общий слой обновляет бейджи */ });
  initReveal();
}
