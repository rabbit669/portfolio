/* ═══════════════════════════════════════════════════════════════════════════
   ASHEN — данные системы
   Дропы, товары, комьюнити, медиа. Без бэкенда: это и есть источник истины.
   ═══════════════════════════════════════════════════════════════════════════ */

export const BRAND = {
  name: 'ASHEN',
  tagline: 'Тише. Свет уже погас.',
  preloader: 'ACCESS GRANTED',
  accession: 'доступ разрешён',
  email: 'signal@ashen.store',
  city: 'Москва',
  socials: [
    { id: 'telegram', name: 'Telegram', handle: '@ashen', note: 'Анонсы дропов. Первым — сюда.', url: 'https://t.me/' },
    { id: 'vk', name: 'VK', handle: 'vk.com/ashen', note: 'Лукбуки, опросы, клипы.', url: 'https://vk.com/' },
    { id: 'tiktok', name: 'TikTok', handle: '@ashen.wear', note: 'Распаковки под тёмный бит.', url: 'https://tiktok.com/' },
  ],
};

/* ── тайминг дропа ─────────────────────────────────────────────────────────
   Ближайший дроп — всегда ближайшая пятница, 20:00. Таймер живой, не врёт.
   ────────────────────────────────────────────────────────────────────────── */

const DROP_HOUR = 20;

/** Ближайшая пятница 20:00 по местному времени (если она ещё не прошла). */
export function nextDropDate(from = new Date()) {
  const d = new Date(from);
  d.setSeconds(0, 0);
  const day = d.getDay();                       // 0 вс … 5 пт
  let delta = (5 - day + 7) % 7;
  const todayIsFriday = delta === 0;
  if (todayIsFriday && d.getHours() >= DROP_HOUR) delta = 7;
  d.setDate(d.getDate() + delta);
  d.setHours(DROP_HOUR, 0, 0, 0);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function fmtDate(date) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date);
}

export function fmtDateLong(date) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
}

export function fmtWeekday(date) {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(date);
}

export function fmtTime(date) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
}

/* ── дропы ─────────────────────────────────────────────────────────────── */

const DROP_SEQUENCE = [
  {
    n: 1, code: 'ASH', ru: 'Пепел',
    thesis: 'Всё началось с серого. База, с которой нечего снимать.',
    palette: ['#8A8A8A', '#3A3A3E', '#0A0A0A'],
    location: 'бетонная лестница',
  },
  {
    n: 2, code: 'VOID', ru: 'Пустота',
    thesis: 'Чёрное на чёрном. Разница — в крое, не в цвете.',
    palette: ['#1B1B20', '#26262C', '#050505'],
    location: 'подземный паркинг',
  },
  {
    n: 3, code: 'NOCTURNE', ru: 'Ноктюрн',
    thesis: 'Ночь как материал. Принты, которые видно только под углом.',
    palette: ['#15151B', '#20202A', '#6B5B8A'],
    location: 'крыша ночью',
  },
  {
    n: 4, code: 'UMBRA', ru: 'Тень',
    thesis: 'Полутень. Объёмы, которые читаются только в движении.',
    palette: ['#2A272C', '#3D3840', '#0B0A0C'],
    location: 'зеркальный коридор',
  },
  {
    n: 5, code: 'STATIC', ru: 'Помехи',
    thesis: 'Помехи в голове — норма. Помехи в ткани — приём.',
    palette: ['#C9C9CD', '#8A8A92', '#0A0B0C'],
    location: 'пустой бассейн',
  },
  {
    n: 6, code: 'HOLLOW', ru: 'Пустой',
    thesis: 'Тише предыдущих. Почти без деталей. Почти без слов.',
    palette: ['#111114', '#1C1C22', '#0A0A0A'],
    location: 'лифт, минус третий',
  },
  {
    n: 7, code: 'OBSIDIAN', ru: 'Обсидиан',
    thesis: 'Вулканическое стекло. Острый край, никакого блеска.',
    palette: ['#101014', '#191922', '#E2E0FF'],
    location: 'крыша, мокрый бетон',
  },
  {
    n: 8, code: 'MIRRORBLACK', ru: 'Чёрное зеркало',
    thesis: 'Ты смотришь на дроп. Дроп смотрит на тебя.',
    palette: ['#C4C4CC', '#6F6F7A', '#09090B'],
    location: 'зеркальная комната',
  },
];

const FIRST_DROP = nextDropDate();
const INTERVAL = 14; // дней между дропами

export const DROPS = DROP_SEQUENCE.map((d, i) => {
  const date = addDays(FIRST_DROP, i * INTERVAL);
  return {
    ...d,
    id: `drop-${String(d.n).padStart(2, '0')}`,
    label: `Дроп ${String(d.n).padStart(2, '0')}`,
    date,
    /** индекс относительно ближайшего дропа */
    offset: i,
    status: i === 0 ? 'live' : 'sold',
    cover: `assets/img/look-${(i % 6) + 1}.png`,
  };
});

export const CURRENT_DROP = DROPS[0];

export function dropById(id) {
  return DROPS.find((d) => d.id === id) || null;
}
export function dropByCode(code) {
  return DROPS.find((d) => d.code === code) || null;
}

/* ── товары ────────────────────────────────────────────────────────────────
   Наличие: числа — это остаток по размеру. 0 = нет.
   ────────────────────────────────────────────────────────────────────────── */

const ALL_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

/** компактная запись остатков: 'S:2 M:5 L:3 XL:0' */
function stock(spec) {
  const out = {};
  for (const pair of spec.split(' ')) {
    const [size, qty] = pair.split(':');
    out[size] = Number(qty);
  }
  return out;
}

function blank() {
  return {};
}

export const PRODUCTS = [
  /* ── Дроп 01 · ASH — распродан целиком ── */
  {
    id: 'hoodie-ash', drop: 'drop-01', kind: 'Худи', name: 'Худи ASHEN / ASH',
    price: 19900, oldPrice: null, color: 'пепельно-серый', colorKey: 'ash',
    desc: 'Серый, как пепел. Мягкий, как тишина. Оверсайз, плотный футер. База, которая не кричит.',
    short: 'Оверсайз, 480 г/м², пепел.',
    details: {
      состав: '92% хлопок, 8% эластан. Футер петля, 480 г/м².',
      крой: 'Оверсайз, спущенное плечо, двойная кокетка, капюшон на двух слоях.',
      уход: 'Стирка 30°, без отжима, сушить в тени. Принт не гладить.',
      производство: 'Москва, малый тираж 120 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },
  {
    id: 'tee-ash', drop: 'drop-01', kind: 'Футболка', name: 'Футболка ASH',
    price: 8900, oldPrice: null, color: 'пепельно-серый', colorKey: 'ash',
    desc: 'Плотный хлопок, свободный силуэт. Носится три года, выглядит как вчера купил.',
    short: '240 г/м², свободный силуэт.',
    details: {
      состав: '100% хлопок, компакт-пенье, 240 г/м².',
      крой: 'Свободный, широкая горловина, укреплённая косая бейка.',
      уход: 'Стирка 30°, наизнанку. Не сушить в машине.',
      производство: 'Москва, тираж 200 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },
  {
    id: 'cargo-ash', drop: 'drop-01', kind: 'Штаны', name: 'Карго ASH',
    price: 21900, oldPrice: null, color: 'серый бетон', colorKey: 'ash',
    desc: 'Широкие, тяжёлые, с карманами под всё, что тебе не нужно. Но пусть будут.',
    short: 'Широкие, 6 карманов, регулировка низа.',
    details: {
      состав: '68% хлопок, 32% нейлон. Плотная саржа с пропиткой.',
      крой: 'Прямой широкий, завышенная посадка, кулиска по низу, 6 карманов.',
      уход: 'Стирка 30°. Пропитку обновлять раз в сезон.',
      производство: 'Москва, тираж 90 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },
  {
    id: 'jacket-ash', drop: 'drop-01', kind: 'Куртка', name: 'Куртка ASH',
    price: 34900, oldPrice: null, color: 'мокрый бетон', colorKey: 'concrete',
    desc: 'Верхний слой системы. Мембрана, глубокий капюшон, тихий звук ткани.',
    short: 'Мембрана 10/10, длинный силуэт.',
    details: {
      состав: 'Внешний слой — нейлон рипстоп с мембраной. Подкладка — сетка.',
      крой: 'Удлинённый, асимметричная молния, регулируемый капюшон.',
      уход: 'Только деликатная стирка 30°. Не отжимать.',
      производство: 'Москва, тираж 60 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },

  /* ── Дроп 02 · VOID ── */
  {
    id: 'cargo-void', drop: 'drop-02', kind: 'Штаны', name: 'Карго VOID',
    price: 22900, oldPrice: null, color: 'чёрный', colorKey: 'black',
    desc: 'Пустота в карманах — метафора. Сами карманы — нет. Чёрные, широкие, с ремнями.',
    short: 'Чёрные, ремни, объёмный крой.',
    details: {
      состав: '70% хлопок, 30% нейлон. 340 г/м².',
      крой: 'Объёмный, съёмные ремни, два накладных кармана с клапанами.',
      уход: 'Стирка 30°, ремни снимать.',
      производство: 'Москва, тираж 140 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },
  {
    id: 'hoodie-void', drop: 'drop-02', kind: 'Худи', name: 'Худи VOID',
    price: 20900, oldPrice: null, color: 'чёрный', colorKey: 'black',
    desc: 'Чёрное худи. Не «база» — фундамент. Тот самый силуэт, который все копируют.',
    short: 'Глубокий чёрный, плотный футер.',
    details: {
      состав: '90% хлопок, 10% полиэстер. 500 г/м².',
      крой: 'Оверсайз, капюшон с жёсткой вставкой, потайные карманы.',
      уход: 'Стирка 30°, сушить горизонтально.',
      производство: 'Москва, тираж 150 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },
  {
    id: 'bag-void', drop: 'drop-02', kind: 'Сумка', name: 'Сумка VOID',
    price: 14900, oldPrice: null, color: 'чёрный', colorKey: 'black',
    desc: 'Носишь пустоту через плечо. Технично, с матовой фурнитурой.',
    short: 'Матовая фурнитура, объём 6 л.',
    details: {
      состав: 'Кордура 500D, подкладка — рипстоп.',
      крой: 'Багет, регулируемый ремень, внутренний карман на молнии.',
      уход: 'Протирать влажной тканью. Не стирать.',
      производство: 'Москва, тираж 180 шт.',
    },
    sizes: blank(),
    restock: false,
  },

  /* ── Дроп 03 · NOCTURNE ── */
  {
    id: 'tee-nocturne', drop: 'drop-03', kind: 'Футболка', name: 'Футболка NOCTURNE',
    price: 9900, oldPrice: null, color: 'чёрный', colorKey: 'black',
    desc: 'Ночная. Чёрная. С принтом, который видно только под углом. Для тех, кто понимает.',
    short: 'Принт под углом, тираж 200.',
    details: {
      состав: '100% хлопок, 250 г/м².',
      крой: 'Свободный, спущенное плечо, принт с двух сторон.',
      уход: 'Стирка 30° наизнанку, принт не гладить.',
      производство: 'Москва, тираж 200 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },
  {
    id: 'hoodie-nocturne', drop: 'drop-03', kind: 'Худи', name: 'Худи NOCTURNE',
    price: 22900, oldPrice: null, color: 'чёрный', colorKey: 'black',
    desc: 'Тёплое чёрное с подсветкой под углом. Днём — просто худи. Ночью — не просто.',
    short: 'Иридисцентная печать, 500 г/м².',
    details: {
      состав: '88% хлопок, 12% полиэстер. Футер с начёсом.',
      крой: 'Оверсайз, втачной рукав, принт на спине.',
      уход: 'Стирка 30°, без кондиционера.',
      производство: 'Москва, тираж 110 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },
  {
    id: 'cargo-nocturne', drop: 'drop-03', kind: 'Штаны', name: 'Карго NOCTURNE',
    price: 23900, oldPrice: null, color: 'чёрный', colorKey: 'black',
    desc: 'Ночные карго. Ткань ловит свет и отдаёт его неохотно.',
    short: 'Светоотдача только под углом.',
    details: {
      состав: '72% хлопок, 28% нейлон, иридисцентная пропитка.',
      крой: 'Прямой, завышенная талия, регулируемый низ.',
      уход: 'Стирка 30°, не тереть.',
      производство: 'Москва, тираж 80 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },

  /* ── Дроп 04 · UMBRA ── */
  {
    id: 'coat-umbra', drop: 'drop-04', kind: 'Пальто', name: 'Пальто UMBRA',
    price: 39900, oldPrice: null, color: 'пепельно-фиолетовый', colorKey: 'violet',
    desc: 'Полутень на плечах. Форма держится сама, ты просто идёшь.',
    short: 'Структурный силуэт, шерсть.',
    details: {
      состав: '80% шерсть, 20% полиамид. Подкладка — вискоза.',
      крой: 'Прямой удлинённый, скрытая застёжка, глубокие карманы в шве.',
      уход: 'Только химчистка.',
      производство: 'Санкт-Петербург, тираж 40 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },
  {
    id: 'hoodie-umbra', drop: 'drop-04', kind: 'Худи', name: 'Худи UMBRA',
    price: 21900, oldPrice: null, color: 'фиолетово-серый', colorKey: 'violet',
    desc: 'Объём появляется в движении. Стоишь — просто худи. Идёшь — архитектура.',
    short: 'Объёмный крой, мягкий футер.',
    details: {
      состав: '90% хлопок, 10% полиэстер. 460 г/м².',
      крой: 'Объёмный, широкий капюшон, реглан.',
      уход: 'Стирка 30°, сушить горизонтально.',
      производство: 'Москва, тираж 130 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },
  {
    id: 'bag-umbra', drop: 'drop-04', kind: 'Сумка', name: 'Сумка UMBRA',
    price: 15900, oldPrice: null, color: 'тёмно-серый', colorKey: 'ash',
    desc: 'Тень через плечо. Ноль логотипов: тебя узнают по силуэту, не по бирке.',
    short: 'Без логотипов, объём 5 л.',
    details: {
      состав: 'Нейлон с покрытием, подкладка — рипстоп.',
      крой: 'Багет, скрытая молния, внутренний карабин.',
      уход: 'Влажная протирка.',
      производство: 'Москва, тираж 160 шт.',
    },
    sizes: blank(),
    restock: false,
  },

  /* ── Дроп 05 · STATIC ── */
  {
    id: 'bag-static', drop: 'drop-05', kind: 'Сумка', name: 'Сумка-багет STATIC',
    price: 16900, oldPrice: null, color: 'серебро', colorKey: 'silver',
    desc: 'Помехи в голове — норм. Сумка-багет STATIC — тоже. Серебро, минимализм, глитч-деталь.',
    short: 'Серебро, глитч-деталь, объём 4 л.',
    details: {
      состав: 'Металлизированное полотно, подкладка — сатин.',
      крой: 'Багет, съёмный ремень, молния со сдвинутым бегунком.',
      уход: 'Только влажная протирка. Не тереть.',
      производство: 'Москва, тираж 100 шт.',
    },
    sizes: blank(),
    restock: false,
  },
  {
    id: 'tee-static', drop: 'drop-05', kind: 'Футболка', name: 'Футболка STATIC',
    price: 9900, oldPrice: null, color: 'белый', colorKey: 'white',
    desc: 'Белая. Редкий случай в системе. Принт — как сбой сигнала.',
    short: 'Белая, принт-сбой.',
    details: {
      состав: '100% хлопок, 240 г/м².',
      крой: 'Свободный, широкий рукав, принт на груди.',
      уход: 'Стирка 40° наизнанку.',
      производство: 'Москва, тираж 150 шт.',
    },
    sizes: stock('S:0 M:0 L:0'),
    restock: false,
  },
  {
    id: 'hoodie-static', drop: 'drop-05', kind: 'Худи', name: 'Худи STATIC',
    price: 21900, oldPrice: null, color: 'светло-серый', colorKey: 'white',
    desc: 'Светлое худи в самой тёмной коллекции. Контраст, который все заметят.',
    short: 'Светло-серое, 480 г/м².',
    details: {
      состав: '92% хлопок, 8% эластан.',
      крой: 'Оверсайз, капюшон на подкладке.',
      уход: 'Стирка 30°, отдельно от тёмного.',
      производство: 'Москва, тираж 120 шт.',
    },
    sizes: stock('M:0 L:0'),
    restock: false,
  },
  {
    id: 'cargo-static', drop: 'drop-05', kind: 'Штаны', name: 'Карго STATIC',
    price: 24900, oldPrice: null, color: 'пепельный', colorKey: 'ash',
    desc: 'Серые карго с глитч-строчкой. Строка в коде тоже иногда съезжает.',
    short: 'Глитч-строчка, 320 г/м².',
    details: {
      состав: '70% хлопок, 30% нейлон.',
      крой: 'Прямой, декоративная смещённая строчка, 4 кармана.',
      уход: 'Стирка 30°.',
      производство: 'Москва, тираж 70 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },

  /* ── Дроп 06 · HOLLOW ── */
  {
    id: 'hoodie-hollow', drop: 'drop-06', kind: 'Худи', name: 'Худи HOLLOW',
    price: 21900, oldPrice: null, color: 'чёрный', colorKey: 'black',
    desc: 'Почти без деталей. Почти без слов. Работает на ощупь и на силуэт.',
    short: 'Минимум деталей, 500 г/м².',
    details: {
      состав: '90% хлопок, 10% полиэстер.',
      крой: 'Оверсайз, скрытые карманы, плоские швы.',
      уход: 'Стирка 30°.',
      производство: 'Москва, тираж 150 шт.',
    },
    sizes: stock('S:0 M:1 L:0'),
    restock: false,
  },
  {
    id: 'cargo-hollow', drop: 'drop-06', kind: 'Штаны', name: 'Карго HOLLOW',
    price: 23900, oldPrice: null, color: 'чёрный', colorKey: 'black',
    desc: 'Пустой крой: ни одной лишней строчки. Только там, где держит форму.',
    short: 'Чистый крой, без декора.',
    details: {
      состав: '68% хлопок, 32% нейлон.',
      крой: 'Прямой, скрытые карманы, плоский пояс.',
      уход: 'Стирка 30°.',
      производство: 'Москва, тираж 90 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },
  {
    id: 'tee-hollow', drop: 'drop-06', kind: 'Футболка', name: 'Футболка HOLLOW',
    price: 8900, oldPrice: null, color: 'графит', colorKey: 'black',
    desc: 'Графит. Носится как вторая кожа, но выглядит как броня.',
    short: 'Графит, 250 г/м².',
    details: {
      состав: '100% хлопок, 250 г/м².',
      крой: 'Прямой, узкая горловина.',
      уход: 'Стирка 30°.',
      производство: 'Москва, тираж 200 шт.',
    },
    sizes: stock('S:0 M:0 L:0 XL:0'),
    restock: false,
  },

  /* ── Дроп 07 · OBSIDIAN — текущий ── */
  {
    id: 'coat-obsidian', drop: 'drop-07', kind: 'Пальто', name: 'Пальто OBSIDIAN',
    price: 42900, oldPrice: 47900, color: 'обсидиан', colorKey: 'black',
    desc: 'Вулканическое стекло в ткани. Острый край, ноль блеска, максимум формы.',
    short: 'Главная вещь дропа. 40 шт.',
    details: {
      состав: '75% шерсть, 25% полиамид. Матовая отделка.',
      крой: 'Удлинённый, асимметричный борт, потайная планка, подкладка — вискоза.',
      уход: 'Только химчистка.',
      производство: 'Санкт-Петербург, тираж 40 шт.',
    },
    sizes: stock('S:3 M:6 L:4 XL:2'),
    restock: false, hero: true,
  },
  {
    id: 'hoodie-obsidian', drop: 'drop-07', kind: 'Худи', name: 'Худи OBSIDIAN',
    price: 23900, oldPrice: null, color: 'обсидиан', colorKey: 'black',
    desc: 'Самый тёмный чёрный, который мы нашли. Дальше — только пустота.',
    short: 'Глубокий чёрный, 520 г/м².',
    details: {
      состав: '88% хлопок, 12% полиэстер. 520 г/м².',
      крой: 'Оверсайз, капюшон на двух слоях, потайной карман.',
      уход: 'Стирка 30°, сушить горизонтально.',
      производство: 'Москва, тираж 130 шт.',
    },
    sizes: stock('S:4 M:9 L:7 XL:3'),
    restock: false,
  },
  {
    id: 'cargo-obsidian', drop: 'drop-07', kind: 'Штаны', name: 'Карго OBSIDIAN',
    price: 25900, oldPrice: null, color: 'обсидиан', colorKey: 'black',
    desc: 'Широкие, тяжёлые, с ремнями. Твоя посадка — вопрос принципа.',
    short: 'Широкие, ремни, 380 г/м².',
    details: {
      состав: '70% хлопок, 30% нейлон.',
      крой: 'Широкий, съёмные ремни, 6 карманов, кулиска по низу.',
      уход: 'Стирка 30°, ремни снимать.',
      производство: 'Москва, тираж 110 шт.',
    },
    sizes: stock('S:2 M:8 L:6 XL:0'),
    restock: false,
  },
  {
    id: 'bag-obsidian', drop: 'drop-07', kind: 'Сумка', name: 'Сумка OBSIDIAN',
    price: 17900, oldPrice: null, color: 'обсидиан', colorKey: 'black',
    desc: 'Носишь камень через плечо. Легко, потому что это нейлон.',
    short: 'Матовая, объём 6 л.',
    details: {
      состав: 'Нейлон 500D с пропиткой.',
      крой: 'Багет, регулируемый ремень, скрытый карман.',
      уход: 'Влажная протирка.',
      производство: 'Москва, тираж 150 шт.',
    },
    sizes: blank(),
    restock: false,
  },
  {
    id: 'tee-obsidian', drop: 'drop-07', kind: 'Футболка', name: 'Футболка OBSIDIAN',
    price: 10900, oldPrice: null, color: 'обсидиан', colorKey: 'black',
    desc: 'Вход в систему за минимальные деньги. Дальше сам.',
    short: 'Точка входа. 260 г/м².',
    details: {
      состав: '100% хлопок, 260 г/м².',
      крой: 'Свободный, спущенное плечо.',
      уход: 'Стирка 30°.',
      производство: 'Москва, тираж 250 шт.',
    },
    sizes: stock('S:1 M:12 L:10 XL:5'),
    restock: false,
  },

  /* ── Дроп 08 · MIRRORBLACK ── */
  {
    id: 'mirror-jacket', drop: 'drop-08', kind: 'Куртка', name: 'Куртка MIRRORBLACK',
    price: 45900, oldPrice: null, color: 'чёрное зеркало', colorKey: 'silver',
    desc: 'Отражающая ткань. Ты смотришь на дроп — дроп смотрит на тебя.',
    short: 'Отражение, мембрана.',
    details: {
      состав: 'Нейлон с зеркальным напылением, мембрана 10/10.',
      крой: 'Прямой, скрытая молния, регулируемый капюшон.',
      уход: 'Только деликатная стирка 30°, без отжима.',
      производство: 'Москва, тираж 50 шт.',
    },
    sizes: stock('S:0 M:0 L:0'),
    restock: false, unreleased: true,
  },
  {
    id: 'mirror-hoodie', drop: 'drop-08', kind: 'Худи', name: 'Худи MIRRORBLACK',
    price: 25900, oldPrice: null, color: 'графит-зеркало', colorKey: 'silver',
    desc: 'Светлое отражение тёмной коллекции. Носится как заявление.',
    short: 'Зеркальный графит.',
    details: {
      состав: '85% хлопок, 15% полиэстер. 500 г/м².',
      крой: 'Оверсайз, капюшон на подкладке.',
      уход: 'Стирка 30°, отдельно.',
      производство: 'Москва, тираж 100 шт.',
    },
    sizes: stock('M:0 L:0 XL:0'),
    restock: false, unreleased: true,
  },
  {
    id: 'mirror-tee', drop: 'drop-08', kind: 'Футболка', name: 'Футболка MIRRORBLACK',
    price: 11900, oldPrice: null, color: 'зеркальный серый', colorKey: 'silver',
    desc: 'Принт-отражение. В зеркале читается иначе, чем на тебе.',
    short: 'Принт-отражение.',
    details: {
      состав: '100% хлопок, 250 г/м².',
      крой: 'Свободный, отражающий принт.',
      уход: 'Стирка 30° наизнанку.',
      производство: 'Москва, тираж 180 шт.',
    },
    sizes: blank(),
    restock: false, unreleased: true,
  },
  {
    id: 'mirror-cargo', drop: 'drop-08', kind: 'Штаны', name: 'Карго MIRRORBLACK',
    price: 27900, oldPrice: null, color: 'зеркальный графит', colorKey: 'silver',
    desc: 'Свет ложится полосами. Ночью выглядит как живой.',
    short: 'Напыление, прямой крой.',
    details: {
      состав: '72% хлопок, 28% нейлон, напыление.',
      крой: 'Прямой, 4 кармана, регулируемый низ.',
      уход: 'Стирка 30°, не тереть.',
      производство: 'Москва, тираж 60 шт.',
    },
    sizes: blank(),
    restock: false, unreleased: true,
  },
  {
    id: 'mirror-bag', drop: 'drop-08', kind: 'Сумка', name: 'Сумка MIRRORBLACK',
    price: 19900, oldPrice: null, color: 'зеркальное серебро', colorKey: 'silver',
    desc: 'В ней видно лицо человека напротив. Иногда — твоё.',
    short: 'Зеркальное серебро, 4 л.',
    details: {
      состав: 'Металлизированный нейлон.',
      крой: 'Багет, съёмный ремень.',
      уход: 'Влажная протирка.',
      производство: 'Москва, тираж 90 шт.',
    },
    sizes: blank(),
    restock: false, unreleased: true,
  },
];

/* доступные фильтры */
export const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export const KINDS = [...new Set(PRODUCTS.map((p) => p.kind))];

export const COLORS = [
  { key: 'black', label: 'Чёрный', hex: '#0f0f11' },
  { key: 'ash', label: 'Пепельный', hex: '#8a8a8a' },
  { key: 'violet', label: 'Фиолетовый', hex: '#6b5b8a' },
  { key: 'silver', label: 'Серебро', hex: '#c4c4cc' },
  { key: 'white', label: 'Белый', hex: '#f0f0f0' },
  { key: 'concrete', label: 'Бетон', hex: '#6e6e70' },
];

export function productById(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}

export function productsOfDrop(dropId) {
  return PRODUCTS.filter((p) => p.drop === dropId);
}

/** есть ли хоть один размер в наличии */
export function inStock(product) {
  if (!product.sizes || !Object.keys(product.sizes).length) return !product.unreleased;
  return Object.values(product.sizes).some((q) => q > 0);
}

export function totalStock(product) {
  return Object.values(product.sizes || {}).reduce((a, b) => a + b, 0);
}

/** статус товара с точки зрения системы */
export function productState(product) {
  if (product.unreleased) return 'soon';
  if (inStock(product)) return 'live';
  return 'out';
}

export const PRODUCT_STATE_LABEL = {
  live: 'В наличии',
  out: 'Распродано',
  soon: 'Скоро',
};

export function hasSizes(product) {
  return !!product.sizes && Object.keys(product.sizes).length > 0;
}

/* ── комьюнити ─────────────────────────────────────────────────────────── */

export const FEED = [
  {
    kind: 'дроп', time: '2 ч',
    title: 'Дроп 07: OBSIDIAN в системе',
    body: 'Пальто, худи, карго, сумка, футболка. 40 пар пальто — и всё. Свои заходят первыми, остальные в очередь.',
    cta: { label: 'К дропу', href: 'catalog.html?drop=drop-07' },
  },
  {
    kind: 'ugc', time: '5 ч',
    title: '«Носил карго VOID неделю. Не снимал»',
    body: '@nkvl прислал в чат. Лук целиком из дропа 02 — карго, худи, сумка. Свет — фонарик телефона. Работает.',
    cta: { label: 'Смотреть UGC', href: 'community.html#ugc' },
  },
  {
    kind: 'плейлист', time: 'вчера',
    title: 'ASHEN / 011 — для очереди',
    body: '43 минуты тёмного эмбиента и бита. Ставим, когда открывается лист ожидания.',
    cta: { label: 'Слушать', href: 'media.html#playlists' },
  },
  {
    kind: 'интервью', time: '2 дня',
    title: '«Мы не делаем одежду для всех»',
    body: 'Разговор с командой ASHEN о тиражах, тишине и о том, почему дропы — это события, а не поставки.',
    cta: { label: 'Читать', href: 'media.html#interviews' },
  },
  {
    kind: 'статус', time: '3 дня',
    title: 'Очередь: 8 431 человек',
    body: 'До цели 10 000 осталось немного. Реферальная ссылка двигает тебя вверх — и друга тоже.',
    cta: { label: 'Моя ссылка', href: 'account.html#referral' },
  },
];

export const UGC = [
  { img: 'assets/img/ugc-1.png', by: '@nkvl', drop: 'VOID', likes: 412 },
  { img: 'assets/img/ugc-2.png', by: '@morozzz', drop: 'NOCTURNE', likes: 318 },
  { img: 'assets/img/ugc-3.png', by: '@a.vshn', drop: 'ASH', likes: 296 },
  { img: 'assets/img/ugc-4.png', by: '@kirill_4', drop: 'UMBRA', likes: 275 },
  { img: 'assets/img/ugc-5.png', by: '@lens.exe', drop: 'MIRRORBLACK', likes: 511 },
  { img: 'assets/img/ugc-6.png', by: '@sonya', drop: 'HOLLOW', likes: 233 },
  { img: 'assets/img/ugc-7.png', by: '@dvrk', drop: 'STATIC', likes: 189 },
  { img: 'assets/img/ugc-8.png', by: '@velvet', drop: 'OBSIDIAN', likes: 402 },
];

export const CHAT_SEED = [
  { who: 'система', text: 'Канал «свои». Здесь тише, чем в телеге. Мат — можно, официоз — нет.', me: false, t: '19:40' },
  { who: '@nkvl', text: 'пальто обсидиан в живую чёрное настолько, что на фото выглядит серым', me: false, t: '19:44' },
  { who: '@sonya', text: 'кто брал карго void — они садятся в размер или больше?', me: false, t: '19:51' },
  { who: '@dvrk', text: 'в размер. если хочешь совсем широко — на размер выше', me: false, t: '19:53' },
  { who: '@lens.exe', text: 'очередь на пятницу уже 8к. норм, я с инвайтом 😌', me: false, t: '20:02' },
  { who: '@kirill_4', text: 'реферальная ссылка реально работает? привёл двух, поднялся на 1400 позиций', me: false, t: '20:09' },
];

/* ── медиа / блог ──────────────────────────────────────────────────────── */

export const POSTS = [
  {
    id: 'lookbook-07',
    tag: 'лукбук', date: '07',
    title: 'OBSIDIAN: лукбук',
    lead: 'Крыша, мокрый бетон, один жёсткий источник. Пять луков, ноль улыбок.',
    body: 'Снимали ночью, при минус двух. Свет — прожектор на стойке и фиолетовая лампа из строительного магазина. Всё, что видно на кадрах — это ровно то, что было: никакого цвета сверху.',
    img: 'assets/img/look-1.png',
  },
  {
    id: 'playlist-011',
    tag: 'плейлист', date: '06',
    title: 'ASHEN / 011 — для очереди',
    lead: '43 минуты. Тёмный эмбиент, даб-техно, один трек с детским хором.',
    body: 'Плейлист обновляем перед каждым дропом. Слушать лучше в наушниках и в очереди — тогда время идёт быстрее.',
    img: 'assets/img/look-2.png',
  },
  {
    id: 'interview-01',
    tag: 'интервью', date: '04',
    title: '«Мы не делаем одежду для всех»',
    lead: 'Команда ASHEN — о тиражах от 40 штук, о тишине и о том, зачем нужна очередь.',
    body: 'Мы не хотим, чтобы нас носили все. Хотим, чтобы вещь была у человека, который понимает, зачем она. Поэтому тиражи маленькие, а дроп — событие, а не поставка на склад.',
    img: 'assets/img/look-3.png',
  },
  {
    id: 'lookbook-night',
    tag: 'лукбук', date: '02',
    title: 'Ночной город: съёмка без света',
    lead: 'Мокрый асфальт, витрины, неон. Свет — только городской.',
    body: 'Вышли в три ночи. Никакого оборудования, кроме камеры и фонаря. Асфальт после дождя сделал половину работы.',
    img: 'assets/img/look-4.png',
  },
  {
    id: 'guide-fit',
    tag: 'гайд', date: '01',
    title: 'Как сесть в оверсайз и не утонуть',
    lead: 'Три правила по посадке худи и карго. Без «носите на размер больше» — это прошлый век.',
    body: 'Первое: плечо должно быть на месте, а не на предплечье. Второе: длина — до середины бедра, иначе силуэт ломается. Третье: широкий низ требует объёма сверху, и наоборот.',
    img: 'assets/img/look-5.png',
  },
  {
    id: 'playlist-010',
    tag: 'плейлист', date: '28',
    title: 'ASHEN / 010 — для распаковки',
    lead: 'Для тех, кто снимает распаковку под тёмный бит.',
    body: 'Под этот список снимается идеально: медленное вступление, плотный ритм на 12-й секунде, тишина в конце.',
    img: 'assets/img/look-6.png',
  },
];

/* ── очередь / лист ожидания ───────────────────────────────────────────── */

export const QUEUE_GOAL = 10000;
export const QUEUE_BASE = 8431;

export const PERKS = [
  { title: 'Ранний доступ', note: '24 часа до открытого дропа. Свои заходят первыми.' },
  { title: 'Очередь', note: 'Номер в очереди виден в кабинете. Реферал двигает вверх.' },
  { title: 'Пуш и почта', note: 'Один сигнал за час. Без спама, без «горячих предложений».' },
  { title: 'Инвайты', note: 'Каждые три друга — один инвайт для человека без очереди.' },
];

export const REFERRAL_REWARD = {
  perFriend: 400,       // позиций вверх за друга
  inviteEvery: 3,       // каждые 3 друга = инвайт
  inviteLeadHours: 24,  // насколько раньше доступ
};

/* ── доставка / оплата ─────────────────────────────────────────────────── */

export const PAYMENTS = [
  { id: 'card', title: 'Карта', note: 'Visa, Mastercard, МИР. Мгновенно.' },
  { id: 'sbp', title: 'СБП', note: 'По QR. Без комиссии.' },
  { id: 'split', title: 'Рассрочка', note: '4 платежа по 25%. Без процентов.' },
];

export const DELIVERY = [
  { id: 'pickup', title: 'Самовывоз', note: 'Москва, точка выдачи. 0 ₽', price: 0, eta: '1–2 дня' },
  { id: 'courier', title: 'Курьер по Москве', note: 'До двери, тёмный пакет', price: 490, eta: 'завтра' },
  { id: 'cdekt', title: 'СДЭК до пункта', note: 'Вся Россия', price: 590, eta: '3–5 дней' },
];

export const FREE_SHIPPING_FROM = 25000;
