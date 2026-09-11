/* Главная вошедшего студента или старосты: радиальное меню.
   В центре — персонаж, по кругу равномерно лучи к точкам.
   Меню три, стрелки переключают их по кругу:
     организации (точки типа noc) → активности → обязательные точки.
   Клик по лучу открывает укороченную карточку с расписанием. */

import { HERO_IMAGE, PARTNERS, PLACEHOLDER_LOGO } from '../content.js';
import { $, api, ask, esc, state, flash, fmtT, fmtDT, bindActions, isPartnerDemo } from './core.js';
import { partnerBanner } from './banner.js';
import { openSheet, sheetBar, isSheetOpen } from './sheet.js';
import { bookingCtx, slotChips } from './slots.js';
import { startFloat } from './float.js';

/* Геометрия колеса — в процентах от его стороны (контейнер квадратный).
   RING — радиус, на котором стоят точки; лучи идут от края центральной
   кнопки (RAY_FROM) до края кружка точки (RAY_TO). */
const RING = 34;
const RAY_FROM = 16;
const RAY_TO = 25.5;

const f = n => n.toFixed(2);

/** Цвет луча говорит о состоянии; текст нужен только скринридеру. */
const STATE_LABELS = { booked: 'вы записаны', done: 'точка пройдена' };

let hubHost = null;
let menuIndex = 0;
let currentItem = null;
let tableTimer = null;
let partnerBannerTimer = null;
let partnerBannerFadeTimer = null;
let partnerBannerIndex = 0;
let carouselRaf = null;
/** Данные последней загрузки: переключение меню по ним же, без новых запросов. */
let data = {
  points: [], ctx: bookingCtx([]), bookings: [], preview: false,
  groupId: null, groups: [], routeBase: '#/home',
};

// ---------- меню ----------

/** API-точка одновременно является карточкой и источником расписания. */
const fromPoint = p => ({
  id: 'p-' + p.id,
  name: p.name,
  desc: p.description,
  logo: p.logo_url || PLACEHOLDER_LOGO,
  about: p.description ? p.description.split(/\n\s*\n/).filter(Boolean) : [],
  images: (p.image_urls || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean),
  point: p,
});

function menus(points) {
  const ofKind = kind => points.filter(p => p.kind === kind).map(fromPoint);
  return [
    {
      title: 'Организации',
      items: ofKind('noc'),
      empty: 'Организации появятся позже.',
    },
    {
      title: 'Активности',
      items: ofKind('activity'),
      empty: 'Дополнительные активности пока не заведены.',
    },
    {
      title: 'Обязательные точки',
      items: ofKind('mandatory'),
      empty: 'Обязательные точки пока не заведены.',
    },
  ];
}

/** Ищет элемент по id во всех меню: ссылка может вести в любое из них. */
function findItem(id) {
  const all = menus(data.points);
  for (let i = 0; i < all.length; i++) {
    const item = all[i].items.find(x => x.id === id);
    if (item) return { item, menu: i };
  }
  return null;
}

/** Обратный поиск: в чьей карточке живёт эта точка (для кнопки у брони). */
const itemOfPoint = pointId =>
  menus(data.points).flatMap(m => m.items).find(x => x.point?.id === pointId);

// ---------- радиальное меню ----------

export async function renderHub(host, options = {}) {
  stopHub();
  hubHost = host;
  const preview = options.preview === true;
  let groups = [];
  let groupId = null;
  let myBookings = [];
  const points = await api('/points');

  if (preview) {
    groups = await api('/groups');
    const requested = Number(options.groupId);
    groupId = groups.some(g => g.id === requested) ? requested : groups[0]?.id;
    if (groupId) myBookings = (await api('/groups/' + groupId)).bookings;
  } else if (state.me.group_id) {
    groupId = state.me.group_id;
    myBookings = await api('/bookings/my');
  }
  state.cache.points = points;
  data = {
    points,
    ctx: bookingCtx(myBookings),
    bookings: myBookings,
    preview,
    groupId,
    groups,
    routeBase: preview ? '#/preview/' + (groupId || '') : '#/home',
  };

  paint();
  startPartnerBanner(host);
}

/** Перерисовка колеса по уже загруженным данным — стрелки ходят без запросов. */
function paint(revealBranches = false) {
  const host = hubHost;
  if (!host?.isConnected) return;
  cancelAnimationFrame(carouselRaf);
  carouselRaf = null;

  const all = menus(data.points);
  menuIndex = ((menuIndex % all.length) + all.length) % all.length;
  const menu = all[menuIndex];
  const { ctx } = data;

  // луч красит и обычная бронь, и назначенная админом
  const activeIds = [ctx.active, ...ctx.fixed].filter(Boolean).map(b => b.point_id);
  const stateOf = item => {
    const p = item.point;
    if (!p) return '';
    // «пройдено» — организатор подтвердил визит; такую точку уже не занять
    if (ctx.completed.has(p.id)) return 'done';
    if (activeIds.includes(p.id)) return 'booked';
    return '';
  };

  const activeItem = ctx.active && itemOfPoint(ctx.active.point_id);

  host.innerHTML = `
    <section class="wrap section hub">
      ${data.preview ? previewBar() : ''}
      <div class="hub__title">
        <h2>${esc(menu.title)}</h2>
        <div class="hub__dots" aria-hidden="true">
          ${all.map((_, i) => `<i class="${i === menuIndex ? 'is-on' : ''}"></i>`).join('')}
        </div>
      </div>

      ${carouselHtml(all, stateOf, revealBranches)}
      ${menu.items.length ? '' : `<p class="note note--empty">${esc(menu.empty)}</p>`}

      <div class="hub__links">
        ${arrow('prev', 'Предыдущее меню', 'M15 18 9 12l6-6')}
        ${data.preview
          ? `<a class="btn btn--sm" href="#/preview-hero/${data.groupId}">Персонаж</a>`
          : isPartnerDemo(state.me) ? '' : '<a class="btn btn--sm" href="#/app/team">Моя команда</a>'}
        <a class="btn btn--sm" href="#/app/rating">Рейтинг</a>
        ${arrow('next', 'Следующее меню', 'm9 18 6-6-6-6')}
      </div>

      <div data-partner-banner>${partnerBanner(PARTNERS[partnerBannerIndex])}</div>

      ${ctx.active ? `
        <div class="notice">
          <span class="notice__dot"></span>
          <div>
            <b>Активная бронь: ${esc(ctx.active.point_name)}</b>
            <span>${fmtDT(ctx.active.starts_at)}–${fmtT(ctx.active.ends_at)}</span>
            <div class="notice__actions">
              ${activeItem
                ? `<button class="btn btn--sm" data-act="open" data-id="${esc(activeItem.id)}">Карточка</button>`
                : ''}
              ${state.me.role === 'leader' || data.preview
                ? `<button class="btn btn--sm btn--danger" data-act="cancel"
                           data-id="${ctx.active.id}" ${data.preview
                             ? 'disabled title="предпросмотр без изменения данных"' : ''}>Отменить бронь</button>`
                : ''}
            </div>
          </div>
        </div>` : ''}

      ${fixedHtml(ctx.fixed)}
    </section>`;

  bindActions(host, {
    open: ({ id }) => {
      const target = data.routeBase + '/' + id;
      // если карточку закрыли мимо роутера (Esc в некоторых браузерах),
      // хеш уже нужный и hashchange не сработает — открываем сами
      if (location.hash === target) return openItemSheet(id);
      location.hash = target;
      return undefined;
    },
    hero: () => {
      location.hash = data.preview ? '#/preview-hero/' + data.groupId : '#/hero';
    },
    'preview-group': () => {
      const id = $('#preview-group').value;
      location.hash = '#/preview/' + id;
    },
    cancel: ({ id }) => cancelBooking(id),
    prev: () => { menuIndex--; paint(); },
    next: () => { menuIndex++; paint(); },
  });

  bindMenuSwipe(host.querySelector('[data-carousel]'));

  // Центры карусели неподвижны относительно своих страниц, дрейфуют только ветви.
  startFloat(host.querySelector('.wheel--current'), { floatCore: false });
}

/**
 * Листает три раздела жестом по карусели. Соседние колёса уже существуют за
 * краями кадра, поэтому появляются синхронно с движением пальца, а не после
 * перерисовки. Не отменяем события движения: вертикальная прокрутка сохраняется.
 */
function bindMenuSwipe(carousel) {
  if (!carousel) return;
  let start = null;
  let ignoreClick = false;
  let pull = 0;
  let settling = false;
  const minDistance = Math.min(120, Math.max(48, carousel.clientWidth * .22));
  const setPull = value => {
    pull = value;
    carousel.style.setProperty('--carousel-x', `${value.toFixed(1)}px`);
    if (!settling) {
      // Растворение следует за пальцем в пределах 50 px от центра.
      const progress = Math.min(1, Math.abs(value) / 50);
      const opacity = 1 - progress * progress * (3 - 2 * progress);
      carousel.style.setProperty('--branches-opacity', String(opacity));
    }
  };
  const settle = (target, done = () => {}) => {
    if (Math.abs(pull - target) < .5) {
      setPull(target);
      carousel.classList.remove('is-swiping');
      done();
      return;
    }
    settling = true;
    animateCarousel(carousel, pull, target, value => setPull(value), () => {
      settling = false;
      if (target === 0) carousel.classList.remove('is-swiping');
      done();
    });
  };

  carousel.addEventListener('pointerdown', event => {
    if (settling || event.pointerType !== 'touch' || !event.isPrimary) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, { passive: true });

  carousel.addEventListener('pointermove', event => {
    if (settling || !start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!carousel.classList.contains('is-swiping') &&
        (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy) * 1.1)) return;
    // Захват после начала жеста сохраняет обычные тапы по кнопкам.
    carousel.setPointerCapture(event.pointerId);

    // Меню следует за пальцем почти один к одному; ограничение не даёт
    // перетянуть его дальше соседней страницы.
    const maxPull = carousel.clientWidth * .88;
    carousel.classList.add('is-swiping');
    setPull(Math.max(-maxPull, Math.min(maxPull, dx)));
  }, { passive: true });

  carousel.addEventListener('pointerup', event => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;

    // Диагональный/вертикальный жест отдаём прокрутке, а не смене раздела.
    if (Math.abs(dx) < minDistance || Math.abs(dx) <= Math.abs(dy) * 1.25) {
      settle(0);
      return;
    }

    ignoreClick = true;
    const direction = dx < 0 ? 1 : -1;
    // После остановки центра проявляем ветви нового меню.
    settle(-direction * carousel.clientWidth, () => {
      menuIndex += direction;
      paint(true);
    });
    // После pointerup браузер может прислать click; не открываем случайную карточку.
    setTimeout(() => { ignoreClick = false; }, 0);
  }, { passive: true });

  carousel.addEventListener('pointercancel', () => { start = null; settle(0); }, { passive: true });
  carousel.addEventListener('click', event => {
    if (!ignoreClick) return;
    ignoreClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

/** Мягко доводит центральный шарик до выбранной страницы. */
function animateCarousel(carousel, from, to, onFrame, done) {
  cancelAnimationFrame(carouselRaf);
  const startedAt = performance.now();
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 360;
  const frame = now => {
    if (!carousel.isConnected) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    // Быстрый выход: карусель не зависает между меню, а финал остаётся мягким.
    const eased = 1 - (1 - progress) ** 3;
    onFrame(from + (to - from) * eased);
    if (progress < 1) {
      carouselRaf = requestAnimationFrame(frame);
    } else {
      carouselRaf = null;
      done();
    }
  };
  carouselRaf = requestAnimationFrame(frame);
}

/** Одна плашка на партнёра: порядок берётся из PARTNERS, смена — каждые 8 секунд. */
function startPartnerBanner(host) {
  if (PARTNERS.length < 2) return;

  partnerBannerIndex %= PARTNERS.length;
  partnerBannerTimer = setInterval(() => {
    const bannerHost = host.querySelector('[data-partner-banner]');
    if (!host.isConnected || !bannerHost) {
      stopHub();
      return;
    }
    partnerBannerIndex = (partnerBannerIndex + 1) % PARTNERS.length;
    bannerHost.classList.add('is-changing');
    partnerBannerFadeTimer = setTimeout(() => {
      if (!bannerHost.isConnected) {
        partnerBannerFadeTimer = null;
        return;
      }
      bannerHost.innerHTML = partnerBanner(PARTNERS[partnerBannerIndex]);
      requestAnimationFrame(() => bannerHost.classList.remove('is-changing'));
      partnerBannerFadeTimer = null;
    }, 180);
  }, 8000);
}

/** Останавливает фоновые действия главной при уходе на другой экран. */
export function stopHub() {
  if (partnerBannerTimer) clearInterval(partnerBannerTimer);
  if (partnerBannerFadeTimer) clearTimeout(partnerBannerFadeTimer);
  partnerBannerTimer = null;
  partnerBannerFadeTimer = null;
  cancelAnimationFrame(carouselRaf);
  carouselRaf = null;
}

function previewBar() {
  return `
    <div class="previewbar">
      <div>
        <b>Предпросмотр старосты</b>
        <span>Только просмотр: действия не изменяют данные.</span>
      </div>
      <div class="previewbar__controls">
        <select id="preview-group" aria-label="Учебная группа">
          ${data.groups.map(g => `<option value="${g.id}" ${g.id === data.groupId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
        </select>
        <button class="btn btn--sm" data-act="preview-group">Показать</button>
        <a class="btn btn--sm" href="#/app/admin">Вернуться в админку</a>
      </div>
    </div>`;
}

const arrow = (act, label, path) => `
  <button class="btn btn--icon" data-act="${act}" aria-label="${label}">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
         stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>
  </button>`;

function carouselHtml(all, stateOf, revealBranches) {
  const previous = all[(menuIndex + all.length - 1) % all.length];
  const current = all[menuIndex];
  const next = all[(menuIndex + 1) % all.length];
  const page = (menu, className, currentPage) => `
    <div class="hub__carousel-page" ${currentPage ? '' : 'aria-hidden="true"'}>
      ${wheelHtml(menu.items, stateOf, className, currentPage)}
    </div>`;

  return `
    <div class="hub__carousel${revealBranches ? ' is-revealing' : ''}" data-carousel>
      <div class="hub__carousel-track">
        ${page(previous, 'wheel--previous', false)}
        ${page(current, 'wheel--current', true)}
        ${page(next, 'wheel--next', false)}
      </div>
    </div>`;
}

function wheelHtml(items, stateOf, className = '', interactive = true) {
  const disabled = interactive ? '' : 'disabled tabindex="-1"';
  const step = 360 / Math.max(items.length, 1);
  const angle = i => ((-90 + i * step) * Math.PI) / 180;

  const rays = items.map((o, i) => {
    const a = angle(i);
    const st = stateOf(o);
    return `<line class="${st ? 'is-' + st : ''}"
                  x1="${f(50 + RAY_FROM * Math.cos(a))}" y1="${f(50 + RAY_FROM * Math.sin(a))}"
                  x2="${f(50 + RAY_TO * Math.cos(a))}" y2="${f(50 + RAY_TO * Math.sin(a))}"/>`;
  }).join('');

  const nodes = items.map((o, i) => {
    const a = angle(i);
    const st = stateOf(o);
    return `
      <button class="node ${st ? 'node--' + st : ''}"
              style="--x:${f(50 + RING * Math.cos(a))};--y:${f(50 + RING * Math.sin(a))}"
              data-act="open" data-id="${esc(o.id)}"
              ${disabled}
              aria-label="${esc(o.name)}${st ? ' — ' + STATE_LABELS[st] : ''}">
        <span class="node__logo"><img src="${esc(o.logo)}" alt="" loading="lazy"></span>
        <span class="node__name">${esc(o.name)}</span>
      </button>`;
  }).join('');

  const partnerDemo = !data.preview && isPartnerDemo(state.me);

  return `
    <div class="wheel ${className}">
      <div class="wheel__branches">
      <svg class="wheel__rays" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="wheel__ring" cx="50" cy="50" r="${RING}"/>
        <g class="wheel__lines">${rays}</g>
      </svg>
      ${nodes}
      </div>

      <button class="core ${partnerDemo ? 'core--static' : ''}" data-act="hero"
              ${partnerDemo ? 'disabled aria-label="Партнёрский демо-режим"' : disabled}>
        <!-- ЗАМЕНИТЬ НА ИЗОБРАЖЕНИЕ ПЕРСОНАЖА (content.js → HERO_IMAGE) -->
        <span class="core__art ${HERO_IMAGE === PLACEHOLDER_LOGO ? 'is-empty' : ''}">
          <img src="${esc(HERO_IMAGE)}" alt="">
        </span>
        <span class="core__label">${partnerDemo ? 'Демо-режим' : 'Персонаж'}</span>
      </button>

    </div>`;
}

/** Назначенные админом точки: экзамен, босс, администрация.
    Показываем время, но кнопок нет — ни отменить, ни перенести нельзя. */
function fixedHtml(fixed) {
  if (!fixed.length) return '';

  const rows = [...fixed]
    .sort((a, b) => a.starts_at - b.starts_at)
    .map(b => `
      <div class="fixed__row">
        <b>${esc(b.point_name)}</b>
        <span>${fmtDT(b.starts_at)}–${fmtT(b.ends_at)}${b.location ? ` · ${esc(b.location)}` : ''}</span>
      </div>`).join('');

  return `
    <div class="card fixed">
      <h2 class="fixed__head">Назначенные точки</h2>
      ${rows}
      <p class="note">Время назначают организаторы — отменить или перенести нельзя.
        На запись к организациям эти точки не влияют.</p>
    </div>`;
}

/** Отмена брони: доступна и с колеса, и из карточки. */
async function cancelBooking(id) {
  const yes = await ask('Отменить бронь? Слот освободится, и можно будет записаться на другую точку.',
    { ok: 'Отменить бронь', cancel: 'Оставить', danger: true });
  if (!yes) return;
  await api('/bookings/' + id, 'DELETE');
  flash('Бронь отменена');
  if (isSheetOpen()) await fillBooking();
  if (hubHost?.isConnected) await renderHub(hubHost);
}

// ---------- укороченная карточка ----------

export async function openItemSheet(id) {
  const found = findItem(id);
  if (!found) { location.hash = data.routeBase; return; }

  currentItem = found.item;
  // ссылка могла прийти из другого меню — покажем за карточкой то самое колесо
  if (found.menu !== menuIndex) { menuIndex = found.menu; paint(); }
  clearInterval(tableTimer);

  const o = currentItem;
  openSheet(`
    <div class="sheet__scroll">
      ${sheetBar()}
      <div class="wrap sheet__body">
        <div class="bubble">
          <span class="org__logo"><img src="${esc(o.logo)}" alt=""></span>
          <h2>${esc(o.name)}</h2>
        </div>

        <article class="paper">
          ${o.desc ? `<p>${esc(o.desc)}</p>` : ''}
          <div class="booking" id="booking"><p class="note">Загружаем расписание…</p></div>
        </article>
      </div>
    </div>`, {
    book: async ({ id: slotId }) => {
      await api('/bookings', 'POST', { slot_id: Number(slotId) });
      flash('Слот забронирован');
      await fillBooking();
      // на колесе луч перекрашивается в фиолетовый
      if (hubHost?.isConnected) await renderHub(hubHost);
    },
    cancel: ({ id: bookingId }) => cancelBooking(bookingId),
    // бронь занята другой точкой — открываем её карточку
    goto: ({ id: itemId }) => { location.hash = '#/home/' + itemId; },
  });

  await fillBooking();

  // Слоты разбирают параллельно, поэтому пока карточка открыта — подтягиваем
  // занятость. Событию `close` у <dialog> доверять нельзя (в webview оно
  // приходит не всегда), поэтому таймер сам проверяет, открыта ли карточка.
  tableTimer = setInterval(() => {
    if (!isSheetOpen()) { clearInterval(tableTimer); return; }
    fillBooking().catch(() => {});
  }, 20000);
}

/** Подгружает расписание точки в открытую карточку. */
async function fillBooking() {
  const host = $('#booking');
  if (!host || !currentItem) return;

  const point = currentItem.point;
  const slots = await api('/slots?point_id=' + point.id);
  const myBookings = data.preview
    ? data.bookings
    : state.me.group_id ? await api('/bookings/my') : [];
  if (data.preview) {
    const mine = new Set(myBookings
      .filter(b => b.status === 'active' || b.status === 'completed')
      .map(b => b.slot_id));
    for (const slot of slots) slot.mine = mine.has(slot.id);
  }

  host.innerHTML = bookingHtml(point, slots, bookingCtx(myBookings));
}

function bookingHtml(point, slots, ctx) {
  return `
    <h3 class="booking__head">Расписание</h3>
    <p class="note">${esc(point.location || 'Место уточняется')}</p>
    ${hintFor(point, ctx)}
    ${slotChips(slots, point, ctx, Date.now() / 1000,
      data.preview ? { role: 'leader', readOnly: true } : {})}`;
}

/** Почему кнопки записи может не быть — объясняем до того, как её нажмут. */
function hintFor(point, ctx) {
  if (point.kind === 'mandatory') {
    return note('Обязательная точка — время назначают организаторы, записываться не нужно.');
  }
  if (data.preview) return note('Предпросмотр: запись и отмена брони отключены.');
  if (isPartnerDemo(state.me)) {
    return note('Партнёрский демо-режим: расписание доступно только для просмотра.');
  }
  if (state.me.role !== 'leader') {
    return note('Записывает команду только староста.');
  }
  if (ctx.completed.has(point.id)) return note('Ваша команда уже прошла эту точку.');

  if (ctx.active?.point_id === point.id) {
    return note('Ваша команда записана на эту точку. Кнопка «Отменить» — в блоке слота.');
  }
  if (ctx.visited.has(point.id)) return note('Ваша команда уже записывалась на эту точку.');

  if (ctx.active) {
    // до чужой брони отсюда не дотянуться — даём кнопку в её карточку
    const item = itemOfPoint(ctx.active.point_id);
    return note(
      `Сначала завершите или отмените бронь: ${ctx.active.point_name}.`,
      item ? `<button class="btn btn--sm" data-act="goto" data-id="${esc(item.id)}">Перейти к брони</button>` : '',
    );
  }
  return note('Занять слот можно не раньше чем за 15 минут до его начала.');
}

const note = (text, action = '') => `
  <div class="note note--empty">
    ${esc(text)}
    ${action ? `<span class="note__act">${action}</span>` : ''}
  </div>`;
