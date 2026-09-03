/* ============================================================================
 *  КОНТЕНТ САЙТА
 *  Общие тексты и статические материалы сайта. Логики здесь нет.
 *
 *  ⚠ Названия, описания и тексты ниже — ЗАГЛУШКИ (lorem ipsum) для вёрстки.
 *    Заменить, когда заказчик пришлёт реальные материалы.
 *
 *  Организации хранятся в БД как точки типа `noc` и управляются админом.
 * ==========================================================================*/

export const PLACEHOLDER_LOGO = '/img/placeholder-logo.svg';

export const EVENT = {
  // ЗАМЕНИТЬ НА ЛОГОТИП, когда придёт вектор (см. .brand в style.css)
  title: 'СМ. Инструкция по выживанию',
};

/* ---------- рекламные баннеры ---------- */

/**
 * Баннеры можно заменить без правок экранов. `href` оставлен пустым, поэтому
 * заглушки не кликабельны; после добавления адреса баннер станет ссылкой.
 * В `image` указывается квадратный логотип или иллюстрация из static/img/
 * (рекомендуется от 512x512); сами пропорции двух плашек задаёт вёрстка.
 */
export const AD_BANNERS = {
  landing: {
    label: 'Реклама',
    title: 'Место для партнёра мероприятия',
    text: 'Расскажите участникам о своём проекте или специальном предложении.',
    image: PLACEHOLDER_LOGO,
    imageAlt: '',
    href: '',
    action: 'Узнать больше',
  },
  hub: {
    label: 'Реклама',
    title: 'Партнёр мероприятия',
    text: 'Предложение для участников',
    image: PLACEHOLDER_LOGO,
    imageAlt: '',
    href: '',
    action: 'Подробнее',
  },
};

/* ---------- партнёры ---------- */

/**
 * Партнёры витрины. Логотипы лежат в `static/img/partners/`; если партнёр
 * передал только текст и ссылку, вместо логотипа показывается его инициал.
 * Карточка открывается на витрине, а кнопка «Перейти» ведёт на `href`.
 */
export const PARTNERS = [
  {
    id: 'tairai', name: 'Тайрай', image: '/img/partners/tairai.png',
    text: 'СПА-салон, где можно отвлечься от городской суеты, выдохнуть и посвятить время себе.',
    href: 'https://tairai.ru/?utm_source=vk&utm_medium=social&utm_campaign=reklama_mgty_baymana',
  },
  {
    id: 'mafia-vip', name: 'Mafia VIP', image: '/img/partners/mafia-vip.png',
    text: 'Клуб в центре Москвы, где можно погрузиться в мир интриг, эмоций и неожиданных поворотов игры.',
    href: 'https://vipclubmafia.ru/?utm_source=site.ru&utm_medium=referral&utm_campaign=sitebayma',
  },
  {
    id: 'kuulklever', name: 'Куулклевер', mark: 'К',
    text: 'Подробнее о партнёре — на его сайте.', href: 'https://www.coolclever.ru/',
  },
  { id: 'ecc-market', name: 'ecc market', image: '/img/partners/ecc-market.png', href: 'https://eccmarket.ru/' },
  {
    id: 'timati-karting', name: 'Тимати Картинг (Black Star Karting)', image: '/img/partners/timati-karting.png',
    href: 'http://rvr.timatikarting.ru',
  },
  {
    id: 'mosigra', name: 'Мосигра (Hobby Games)', image: '/img/partners/mosigra.png',
    text: 'Крупнейшая сеть магазинов настольных игр, моделей и подарков для любой компании и настроения.',
    href: 'https://hobbygames.ru/',
  },
  {
    id: 'ballers-street', name: 'ballers street', image: '/img/partners/ballers-street.jpg',
    text: 'Развлекательный центр для семейного отдыха: боулинг, бильярд, PS5, караоке и танцпол в ТРЦ «Ривьера».',
    href: 'https://ballers.moscow/',
  },
  {
    id: 'debosh', name: 'Комната ярости - Дебош', image: '/img/partners/debosh.png',
    text: 'Первая в России комната ярости: оставьте здесь злость и усталость, выпустите пар и перезагрузитесь.',
    href: 'https://debosh.me/',
  },
  {
    id: 'bestiary', name: 'Музей криптозоологии "Бестиарий"', image: '/img/partners/bestiary.png',
    text: 'Единственный в Москве художественный музей, посвящённый мифическим и легендарным существам.',
    href: 'https://moscow-bestiary.ru',
  },
  {
    id: 'terra', name: 'TERRA', image: '/img/partners/terra.png',
    text: 'Клуб настольных игр для опытных игроков и тех, кто только открывает для себя это увлечение.',
    href: 'https://vk.ru/terra_games',
  },
  {
    id: 'rusana', name: 'Швейное предприятие «Русана»', image: '/img/partners/rusana.png',
    text: 'Современная спецодежда и промо-одежда: бомберы, жилеты и куртки с вышивкой или печатью для командного мерча.',
    href: 'https://uniforma-rusana.com/catalog/merch/',
  },
  {
    id: 'emalis', name: 'Музей эмальерного искусства "Эмалис"', mark: 'Э',
    text: 'Пространство искусства горячей эмали с экскурсиями и мастер-классами, где можно создать картину или украшение.',
    href: 'https://emalis.org/',
  },
];

/* ---------- персонаж ---------- */

/** ЗАМЕНИТЬ НА ИЗОБРАЖЕНИЕ ПЕРСОНАЖА: положить арт в static/img/ и указать путь.
    Пока стоит плейсхолдер — страница персонажа рисует его блёклым. */
export const HERO_IMAGE = PLACEHOLDER_LOGO;

/** Характеристики. Ключи обязаны совпадать со STAT_KEYS в src/models.rs. */
export const STATS = [
  { key: 'courage', label: 'Мужество' },
  { key: 'will', label: 'Воля' },
  { key: 'labor', label: 'Труд' },
  { key: 'persistence', label: 'Упорство' },
];

/** До скольки делений рисуется шкала характеристики. Только оформление:
    значение выше просто заполняет её целиком. */
export const STAT_SCALE = 10;
