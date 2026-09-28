/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — каталог
   Фильтры: размер, цвет, дроп, наличие. Товары как арт-объекты.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  PRODUCTS, DROPS, COLORS, SIZE_ORDER, KINDS,
  productState, inStock, totalStock, dropById, productsOfDrop,
} from '../data.js';
import { wishlist, store } from '../store.js';
import { $, $$, el, esc, money, qsParam, setParam, initReveal, pluralize } from '../util.js';
import { productGrid, toast } from '../ui.js';

const state = {
  drop: '',
  sizes: new Set(),
  colors: new Set(),
  kinds: new Set(),
  stock: 'all',     // all | in | out | soon
  sort: 'new',      // new | cheap | expensive | stock
};

/* ── фильтрация ────────────────────────────────────────────────────────── */

function matches(product) {
  if (state.drop && product.drop !== state.drop) return false;
  if (state.kinds.size && !state.kinds.has(product.kind)) return false;
  if (state.colors.size && !state.colors.has(product.colorKey)) return false;
  if (state.sizes.size) {
    const has = [...state.sizes].some((s) => (product.sizes?.[s] ?? 0) > 0);
    if (!has) return false;
  }
  const st = productState(product);
  if (state.stock === 'in' && st !== 'live') return false;
  if (state.stock === 'out' && st !== 'out') return false;
  if (state.stock === 'soon' && st !== 'soon') return false;
  return true;
}

function sorted(list) {
  const arr = [...list];
  switch (state.sort) {
    case 'cheap': return arr.sort((a, b) => a.price - b.price);
    case 'expensive': return arr.sort((a, b) => b.price - a.price);
    case 'stock': return arr.sort((a, b) => totalStock(b) - totalStock(a));
    default: {
      // «новые» — по номеру дропа: свежий сверху
      const order = Object.fromEntries(DROPS.map((d, i) => [d.id, i]));
      return arr.sort((a, b) => (order[b.drop] ?? 0) - (order[a.drop] ?? 0));
    }
  }
}

/* ── чипы ──────────────────────────────────────────────────────────────── */

/** Внимание: data-size занят страницей товара (кнопки размеров), поэтому
    фильтры используют data-filter-size / data-filter-color. */
function chip(label, pressed, onClick, extra = {}) {
  const c = el('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(pressed), ...extra,
  }, label);
  c.addEventListener('click', onClick);
  return c;
}

export default async function catalog() {
  /* пришли по ссылке ?drop=drop-07 или ?ref=... */
  const dropParam = qsParam('drop');
  if (dropParam && dropById(dropParam)) state.drop = dropParam;

  const host = $('[data-filters]');
  const gridHost = $('[data-grid]');
  const countHost = $('[data-count]');
  const chipsHost = $('[data-active-chips]');
  const sortHost = $('[data-sort]');

  /* ── панель фильтров ── */
  const drawFilters = () => {
    if (!host) return;
    host.innerHTML = '';

    const group = (title, nodes) => {
      const g = el('div', { class: 'filter-group' });
      g.append(el('p', { class: 'mono-label', text: title }));
      const row = el('div', { class: 'row row--wrap', style: 'gap:.4rem;margin-top:.6rem' });
      nodes.forEach((n) => row.append(n));
      g.append(row);
      return g;
    };

    /* дропы */
    const dropNodes = [
      chip('Все', !state.drop, () => { state.drop = ''; setParam('drop', ''); paint(); }),
      ...DROPS.map((d) => chip(`${String(d.n).padStart(2, '0')} · ${d.code}`, state.drop === d.id, () => {
        state.drop = state.drop === d.id ? '' : d.id;
        setParam('drop', state.drop);
        paint();
      })),
    ];
    host.append(group('Дроп', dropNodes));

    /* категории */
    host.append(group('Категория', KINDS.map((k) => chip(k, state.kinds.has(k), () => {
      state.kinds.has(k) ? state.kinds.delete(k) : state.kinds.add(k);
      paint();
    }))));

    /* размеры */
    const sizeNodes = SIZE_ORDER.map((s) => {
      const anyInStock = PRODUCTS.some((p) => (p.sizes?.[s] ?? 0) > 0);
      return chip(s, state.sizes.has(s), () => {
        state.sizes.has(s) ? state.sizes.delete(s) : state.sizes.add(s);
        paint();
      }, anyInStock
        ? { 'data-filter-size': s }
        : { 'data-filter-size': s, disabled: true, title: 'Размера нет ни в одном дропе' });
    });
    host.append(group('Размер', sizeNodes));

    /* цвет */
    host.append(group('Цвет', COLORS.map((c) => chip(c.label, state.colors.has(c.key), () => {
      state.colors.has(c.key) ? state.colors.delete(c.key) : state.colors.add(c.key);
      paint();
    }))));

    /* наличие */
    host.append(group('Наличие', [
      chip('Всё', state.stock === 'all', () => { state.stock = 'all'; paint(); }),
      chip('В наличии', state.stock === 'in', () => { state.stock = 'in'; paint(); }),
      chip('Распродано', state.stock === 'out', () => { state.stock = 'out'; paint(); }),
      chip('Скоро', state.stock === 'soon', () => { state.stock = 'soon'; paint(); }),
    ]));

    /* сброс */
    const active = state.drop || state.sizes.size || state.colors.size || state.kinds.size || state.stock !== 'all';
    if (active) {
      const reset = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Сбросить всё');
      reset.addEventListener('click', () => {
        state.drop = ''; state.sizes.clear(); state.colors.clear(); state.kinds.clear(); state.stock = 'all';
        setParam('drop', '');
        paint();
      });
      host.append(reset);
    }
  };

  /* ── активные фильтры над сеткой ── */
  const drawActiveChips = () => {
    if (!chipsHost) return;
    chipsHost.innerHTML = '';
    const tags = [];
    if (state.drop) tags.push(['дроп ' + dropById(state.drop).code, () => { state.drop = ''; setParam('drop', ''); paint(); }]);
    state.kinds.forEach((k) => tags.push([k, () => { state.kinds.delete(k); paint(); }]));
    [...state.sizes].forEach((s) => tags.push(['размер ' + s, () => { state.sizes.delete(s); paint(); }]));
    [...state.colors].forEach((c) => tags.push([COLORS.find((x) => x.key === c)?.label || c, () => { state.colors.delete(c); paint(); }]));
    if (state.stock !== 'all') tags.push([{ in: 'в наличии', out: 'распродано', soon: 'скоро' }[state.stock], () => { state.stock = 'all'; paint(); }]);

    for (const [label, onClick] of tags) {
      const t = el('button', { class: 'chip is-active', type: 'button' }, label + ' ✕');
      t.addEventListener('click', onClick);
      chipsHost.append(t);
    }
  };

  /* ── сетка ── */
  const paint = () => {
    drawFilters();
    drawActiveChips();

    const list = sorted(PRODUCTS.filter(matches));
    if (gridHost) {
      gridHost.innerHTML = '';
      if (!list.length) {
        gridHost.innerHTML = `
          <div class="empty-state" style="grid-column:1/-1">
            <span class="status status--out">0 позиций</span>
            <p class="t-sm display">Такое не найдено.</p>
            <p class="body-muted measure-sm">Система не выдала ни одной вещи по этим фильтрам. Попробуй шире — или жди дропа.</p>
            <a class="btn btn--sm" href="waitlist.html">В лист ожидания</a>
          </div>`;
      } else {
        gridHost.append(productGrid(list));
      }
    }
    if (countHost) {
      countHost.textContent = `${pluralize(list.length, ['позиция', 'позиции', 'позиций'])}`;
    }
    initReveal(gridHost || document);
  };

  if (sortHost) {
    sortHost.innerHTML = `
      <option value="new">Сначала новые</option>
      <option value="cheap">Дешевле</option>
      <option value="expensive">Дороже</option>
      <option value="stock">Больше в наличии</option>`;
    sortHost.value = state.sort;
    sortHost.addEventListener('change', () => { state.sort = sortHost.value; paint(); });
  }

  /* поиск по строке */
  const search = $('[data-search]');
  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (!gridHost) return;
    const list = sorted(PRODUCTS.filter((p) => matches(p) && (!q
      || p.name.toLowerCase().includes(q)
      || p.kind.toLowerCase().includes(q)
      || p.desc.toLowerCase().includes(q)
      || p.color.toLowerCase().includes(q))));
    gridHost.innerHTML = '';
    if (list.length) gridHost.append(productGrid(list));
    else gridHost.innerHTML = `<p class="body-muted" style="grid-column:1/-1">Ничего. Даже в системе нет.</p>`;
    if (countHost) countHost.textContent = pluralize(list.length, ['позиция', 'позиции', 'позиций']);
    initReveal(gridHost);
  });

  /* ── заголовок зависит от фильтра дропа ── */
  const head = $('[data-catalog-title]');
  const lead = $('[data-catalog-lead]');
  if (state.drop) {
    const d = dropById(state.drop);
    if (head) head.textContent = `${d.label}: ${d.code}`;
    if (lead) lead.textContent = `${d.thesis} Локация съёмки — ${d.location}.`;
  }

  /* ── вишлист-событие: сердечко в карточке уже обработано ── */
  document.addEventListener('ashen:wish', (e) => {
    const { id, on } = e.detail;
    const p = PRODUCTS.find((x) => x.id === id);
    toast(on ? 'В вишлисте' : 'Убрано из вишлиста', on ? `${p?.name}. Напомним перед дропом.` : '', 2400);
  });

  paint();
}
