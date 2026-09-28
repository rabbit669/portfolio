/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — мелочи, из которых собирается система
   ═══════════════════════════════════════════════════════════════════════════ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Быстрый create с классами и атрибутами. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const nf = new Intl.NumberFormat('ru-RU');

/** «19 900 ₽» — цифры в системе всегда с пробелом-разделителем. */
export function money(value) {
  return `${nf.format(Math.round(value))} ₽`;
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/** «2 дня», «5 часов» — для очереди и таймеров. */
export function pluralize(n, forms) {
  return `${nf.format(n)} ${plural(n, ...forms)}`;
}

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const pad2 = (n) => String(n).padStart(2, '0');

/** Разбить миллисекунды в удобную структуру для таймера. */
export function splitDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    total,
    done: total <= 0,
  };
}

/* ── наблюдатели ───────────────────────────────────────────────────────── */

export function onIntersect(nodes, cb, opts = {}) {
  const list = [...nodes];
  if (!list.length) return () => {};
  if (!('IntersectionObserver' in window)) { list.forEach((n) => cb(n)); return () => {}; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { cb(e.target); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08, ...opts });
  list.forEach((n) => io.observe(n));
  return () => io.disconnect();
}

/** Появление блоков при скролле — все [data-reveal] на странице. */
export function initReveal(root = document) {
  const nodes = $$('[data-reveal]', root).filter((n) => !n.classList.contains('is-in'));
  onIntersect(nodes, (n) => n.classList.add('is-in'));
  // те, что уже в кадре при загрузке
  requestAnimationFrame(() => {
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      if (r.top < innerHeight * 0.94 && r.bottom > 0) n.classList.add('is-in');
    }
  });
}

/* ── параллакс ─────────────────────────────────────────────────────────── */

export function initParallax(root = document) {
  const nodes = $$('[data-parallax]', root);
  if (!nodes.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let raf = null;
  const tick = () => {
    raf = null;
    const vh = innerHeight;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) continue;
      const speed = parseFloat(n.dataset.parallax) || 0.12;
      const progress = (r.top + r.height / 2 - vh / 2) / vh;   // -1..1
      n.style.transform = `translate3d(0, ${(-progress * speed * 100).toFixed(2)}px, 0)`;
    }
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(tick); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  tick();
}

/* ── курсор ────────────────────────────────────────────────────────────── */

export function initCursor() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ring = el('div', { class: 'cursor', 'aria-hidden': 'true' });
  const dot = el('div', { class: 'cursor-dot', 'aria-hidden': 'true' });
  document.body.append(ring, dot);
  document.body.classList.add('has-cursor');

  let mx = innerWidth / 2, my = innerHeight / 2;
  let rx = mx, ry = my, dx = mx, dy = my;
  let seen = false;

  const move = (e) => {
    mx = e.clientX; my = e.clientY;
    if (!seen) { seen = true; ring.classList.add('is-on'); dot.classList.add('is-on'); rx = mx; ry = my; dx = mx; dy = my; }
  };
  addEventListener('pointermove', move, { passive: true });
  addEventListener('pointerdown', () => ring.classList.add('is-down'));
  addEventListener('pointerup', () => ring.classList.remove('is-down'));
  addEventListener('pointerleave', () => { ring.classList.remove('is-on'); dot.classList.remove('is-on'); });
  document.addEventListener('mouseover', (e) => {
    const hot = e.target.closest('a, button, .product, .chip, .ugc-tile, input, select, label');
    ring.classList.toggle('is-hot', !!hot);
  });

  const loop = () => {
    rx = lerp(rx, mx, 0.16);
    ry = lerp(ry, my, 0.16);
    dx = lerp(dx, mx, 0.42);
    dy = lerp(dy, my, 0.42);
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`;
    dot.style.transform = `translate3d(${dx}px, ${dy}px, 0) translate(-50%, -50%)`;
    requestAnimationFrame(loop);
  };
  loop();
}

/* ── прогресс чтения страницы ──────────────────────────────────────────── */

export function initScrollRail() {
  const rail = el('div', { class: 'progress-rail', 'aria-hidden': 'true' });
  document.body.append(rail);
  const update = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    rail.style.width = `${max > 0 ? clamp(scrollY / max) * 100 : 0}%`;
  };
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
}

/* ── glitch-эффект для текста (заголовки, кнопки) ──────────────────────── */

export function glitchText(node, text, glitchChars = '▚▞░▒▓#@%&') {
  if (!node) return () => {};
  const original = text;
  let timer = null;
  return {
    start(duration = 520) {
      const t0 = performance.now();
      const step = () => {
        const t = (performance.now() - t0) / duration;
        if (t >= 1) { node.textContent = original; return; }
        node.textContent = [...original].map((ch) => {
          if (ch === ' ') return ch;
          return Math.random() < 0.28 * (1 - t)
            ? glitchChars[(Math.random() * glitchChars.length) | 0]
            : ch;
        }).join('');
        timer = requestAnimationFrame(step);
      };
      cancelAnimationFrame(timer);
      step();
    },
    stop() { cancelAnimationFrame(timer); node.textContent = original; },
  };
}

/* ── прочее ────────────────────────────────────────────────────────────── */

export function qsParam(name) {
  return new URLSearchParams(location.search).get(name);
}

export function setParam(name, value) {
  const url = new URL(location.href);
  if (value === null || value === undefined || value === '') url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  history.replaceState(null, '', url);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Безопасный localStorage — приватный режим не должен ронять систему. */
export const safeStore = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch { /* тихо */ }
  },
};
