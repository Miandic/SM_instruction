/* Главная для гостя: карточки организаций и вход. Карточка раскрывается
   на весь экран — полный текст и галерея. Короткая версия с записью
   по слотам живёт на главной вошедшего пользователя (hub.js). */

import { PARTNERS, PLACEHOLDER_LOGO } from '../content.js';
import { api, esc, state, homeRoute, bindActions } from './core.js';
import { openSheet, sheetBar } from './sheet.js';

let organizations = [];
let activePartnerId = null;

const fromPoint = p => ({
  id: 'p-' + p.id,
  name: p.name,
  desc: p.description,
  logo: p.logo_url || PLACEHOLDER_LOGO,
  about: p.description ? p.description.split(/\n\s*\n/).filter(Boolean) : [],
  images: (p.image_urls || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean),
});

const byId = id => organizations.find(o => o.id === id);

function orgCard(o) {
  return `
    <button class="org" data-act="open" data-id="${esc(o.id)}">
      <span class="org__head">
        <span class="org__logo"><img src="${esc(o.logo)}" alt="" loading="lazy"></span>
        <span class="org__name">${esc(o.name)}</span>
      </span>
      <span class="org__desc">${esc(o.desc)}</span>
    </button>`;
}

const partnerIcon = p => `
  <button class="partner-icon partner-icon--${esc(p.id)} ${activePartnerId === p.id ? 'is-active' : ''}"
          data-act="toggle-partner" data-id="${esc(p.id)}"
          data-partner-key="icon-${esc(p.id)}"
          aria-expanded="${activePartnerId === p.id}" aria-controls="partner-card">
    <span class="partner-icon__image ${p.image ? '' : 'partner-icon__image--mark'}">
      ${p.image
        ? `<img src="${esc(p.image)}" alt="" loading="lazy">`
        : `<span aria-hidden="true">${esc(p.mark || p.name.slice(0, 1))}</span>`}
    </span>
    <span class="partner-icon__name">${esc(p.name)}</span>
  </button>`;

function partnerCard() {
  const p = PARTNERS.find(item => item.id === activePartnerId);
  if (!p) return '';

  return `
    <article class="partner-card partner-card--${esc(p.id)}" id="partner-card" data-act="collapse-partner" data-id="${esc(p.id)}"
             data-partner-key="card-${esc(p.id)}"
             role="button" tabindex="0" aria-label="Свернуть карточку ${esc(p.name)}">
      <div class="partner-card__head">
        <span class="partner-card__image ${p.image ? '' : 'partner-card__image--mark'}">
          ${p.image
            ? `<img src="${esc(p.image)}" alt="" loading="lazy">`
            : `<span aria-hidden="true">${esc(p.mark || p.name.slice(0, 1))}</span>`}
        </span>
        <div>
          <p class="partner-card__eyebrow">Партнёр мероприятия</p>
          <h3>${esc(p.name)}</h3>
        </div>
      </div>
      <p>${esc(p.text || 'Подробнее о партнёре — на его сайте.')}</p>
      <button class="btn btn--primary partner-card__go" data-act="visit-partner"
              data-url="${esc(p.href)}">Перейти <span aria-hidden="true">→</span></button>
    </article>`;
}

const partnerColumns = () => {
  if (window.matchMedia('(min-width: 760px)').matches) return 6;
  if (window.matchMedia('(min-width: 520px)').matches) return 4;
  return 3;
};

function partnerGrid() {
  const activeIndex = PARTNERS.findIndex(p => p.id === activePartnerId);
  if (activeIndex < 0) return PARTNERS.map(partnerIcon).join('');

  // Вставляем подробности после последнего логотипа в строке выбранного.
  // Так на телефоне карточка не оказывается внизу списка партнёров.
  const endOfRow = Math.min(
    (Math.floor(activeIndex / partnerColumns()) + 1) * partnerColumns() - 1,
    PARTNERS.length - 1,
  );
  return PARTNERS.map((p, index) => `${partnerIcon(p)}${index === endOfRow ? partnerCard() : ''}`).join('');
}

function partnersSection() {
  return `
    <section class="partners" aria-labelledby="partners-title">
      <h2 id="partners-title" class="section__head">Наши партнёры</h2>
      <p class="note partners__intro">Нажмите на логотип, чтобы узнать больше.</p>
      <div class="partners__grid">${partnerGrid()}</div>
    </section>`;
}

function paintPartners(host) {
  const section = host.querySelector('.partners');
  if (!section) return;

  // FLIP: после смены разметки возвращаем иконки на прежнюю позицию и за
  // 0,1 с доводим их до новой. Так строка мягко раздвигается и сжимается,
  // хотя карточка вставляется прямо в CSS-grid.
  const before = new Map([...section.querySelectorAll('[data-partner-key]')].map(el => [
    el.dataset.partnerKey, el.getBoundingClientRect(),
  ]));
  section.outerHTML = partnersSection();

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !Element.prototype.animate) return;
  host.querySelectorAll('[data-partner-key]').forEach(el => {
    const old = before.get(el.dataset.partnerKey);
    if (!old) return;
    const next = el.getBoundingClientRect();
    const x = old.left - next.left;
    const y = old.top - next.top;
    if (x || y) el.animate([
      { transform: `translate(${x}px, ${y}px)` },
      { transform: 'translate(0, 0)' },
    ], { duration: 100, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  });
}

export async function renderLanding(host) {
  const loggedIn = !!state.me;
  activePartnerId = null;
  organizations = (await api('/points')).filter(p => p.kind === 'noc').map(fromPoint);

  host.innerHTML = `
    <section class="wrap section">
      <div class="orgs">${organizations.map(orgCard).join('') ||
        '<p class="note note--empty">Организации пока не заведены.</p>'}</div>
      <div class="enter">
        <a class="btn btn--primary btn--lg" href="${loggedIn ? homeRoute() : '#/auth'}">
          ${loggedIn ? 'Личный кабинет' : 'Вход'}
        </a>
      </div>
      ${partnersSection()}
    </section>`;

  bindActions(host, {
    open: ({ id }) => { location.hash = '#/org/' + id; },
    'toggle-partner': ({ id }) => {
      activePartnerId = activePartnerId === id ? null : id;
      paintPartners(host);
    },
    'collapse-partner': () => {
      activePartnerId = null;
      paintPartners(host);
    },
    'visit-partner': ({ url }) => { window.open(url, '_blank', 'noopener,noreferrer'); },
  });
}

// ---------- полноэкранная карточка ----------

export function openOrg(id) {
  const o = byId(id);
  if (!o) { location.hash = '#/'; return; }

  openSheet(`
    <div class="sheet__scroll">
      ${sheetBar()}
      <div class="wrap sheet__body">
        <div class="bubble">
          <span class="org__logo"><img src="${esc(o.logo)}" alt=""></span>
          <h2>${esc(o.name)}</h2>
        </div>

        <article class="paper">
          ${(o.about || []).map(p => `<p>${esc(p)}</p>`).join('')}
          ${(o.images || []).length ? `
            <div class="gallery">
              ${o.images.map(src => `
                <span class="ph ${src === PLACEHOLDER_LOGO ? 'ph--empty' : ''}">
                  <img src="${esc(src)}" alt="" loading="lazy">
                </span>`).join('')}
            </div>` : ''}
        </article>
      </div>
    </div>`);
}
