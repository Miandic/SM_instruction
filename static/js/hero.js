/* Страница персонажа: изображение, счётчик очков и четыре характеристики,
   которые староста прокачивает за баллы команды. */

import { characterImage, PLACEHOLDER_LOGO, STATS, STAT_SCALE } from '../content.js';
import { api, esc, state, flash, fmtPoints, bindActions } from './core.js';

let heroHost = null;

export async function renderHero(host, options = {}) {
  heroHost = host;
  const preview = options.preview === true;
  const groupId = preview ? Number(options.groupId) : state.me.group_id;

  if (!groupId) {
    host.innerHTML = `
      <section class="wrap section hero">
        ${back(preview, groupId)}
        <p class="note note--empty">Аккаунт не привязан к команде — прокачивать нечего.</p>
      </section>`;
    return;
  }

  const d = await api('/groups/' + groupId);
  const g = d.group;
  const cost = d.upgrade_cost;
  const isLeader = state.me.role === 'leader' && !preview;
  const leaderView = isLeader || preview;
  // До подтверждения выбора показываем арт первого (или выбранного в списке)
  // персонажа. Сама команда при этом ещё не получает character_id.
  if (!g.character_name && leaderView && !state.cache.characters.length) {
    state.cache.characters = await api('/characters');
  }
  const previewName = g.character_name || state.cache.characters[0]?.name;
  const image = characterImage(previewName);

  host.innerHTML = `
    <section class="wrap section hero">
      ${back(preview, groupId)}
      ${preview ? `<div class="previewbar">
        <div><b>Предпросмотр страницы персонажа</b>
          <span>Кнопки выбора и прокачки отключены.</span></div>
        <a class="btn btn--sm" href="#/app/admin">Вернуться в админку</a>
      </div>` : ''}

      <div class="hero__art ${image === PLACEHOLDER_LOGO ? 'is-empty' : ''}">
        <img src="${esc(image)}" alt="${esc(g.character_name || 'Персонаж')}">
      </div>

      <header class="hero__title">
        <h1>${esc(g.character_name || 'Персонаж не выбран')}</h1>
        <p class="hero__sub">${esc(g.name)} · кафедра СМ${g.department}</p>
      </header>

      ${g.character_name ? '' : await pickerHtml(leaderView, preview)}

      <div class="pointsbar">
        <div>
          <span class="pointsbar__label">Свободные очки</span>
          <span class="pointsbar__value">${fmtPoints(d.available)}</span>
        </div>
        <div>
          <span class="pointsbar__label">Всего заработано</span>
          <span class="pointsbar__value">${fmtPoints(g.total_points)}</span>
        </div>
        <div>
          <span class="pointsbar__label">Уровень</span>
          <span class="pointsbar__value">${g.level}</span>
        </div>
      </div>

      <div class="stats">
        ${STATS.map(s => statHtml(
          s, d.stats[s.key] ?? 0, d.available, cost, leaderView, preview)).join('')}
      </div>

      <p class="note">Один уровень характеристики стоит ${cost} ${plural(cost)}.
        ${preview ? 'В предпросмотре прокачка отключена.'
          : isLeader ? 'Потраченные баллы не возвращаются.'
          : 'Прокачивает команду староста — у студента страница только для просмотра.'}</p>
    </section>`;

  bindActions(host, ACTIONS);
  bindCharacterPreview(host);
}

const back = (preview = false, groupId = null) => `
  <a class="backlink" href="${preview ? '#/preview/' + groupId : '#/home'}">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
         stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18 9 12l6-6"/></svg>
    На главную
  </a>`;

function statHtml(stat, value, available, cost, isLeader, preview = false) {
  const filled = Math.min(value, STAT_SCALE);
  const pips = Array.from({ length: STAT_SCALE },
    (_, i) => `<i class="${i < filled ? 'is-on' : ''}"></i>`).join('');

  const enabled = isLeader && available >= cost && !preview;
  // на кнопке — что получишь (+1 уровень), цена вынесена в подсказку и в текст ниже
  const title = preview ? 'предпросмотр без изменения данных'
    : !isLeader ? 'прокачивает староста'
    : available < cost ? 'не хватает очков' : `потратить ${cost} ${plural(cost)}`;

  return `
    <div class="stat">
      <span class="stat__name">${esc(stat.label)}</span>
      <span class="stat__value">${value}</span>
      <span class="stat__pips" aria-hidden="true">${pips}</span>
      <button class="btn btn--sm ${enabled ? 'btn--primary' : ''}" data-act="up"
              data-stat="${esc(stat.key)}" title="${esc(title)}"
              aria-label="Прокачать: ${esc(stat.label)}, ${cost} ${plural(cost)}"
              ${enabled ? '' : 'disabled'}>+1</button>
    </div>`;
}

/** Персонажа выбирают один раз — до выбора показываем список старосте. */
async function pickerHtml(isLeader, preview = false) {
  if (!isLeader) return '<p class="note note--empty">Персонажа выбирает староста команды.</p>';

  if (!state.cache.characters.length) state.cache.characters = await api('/characters');
  return `
    <div class="card card--accent">
      <p class="card__text">Персонаж ещё не выбран.</p>
      <div class="inline-form">
        <select id="char-sel" aria-label="Персонаж">
          ${state.cache.characters.map(c =>
            `<option value="${c.id}">${esc(c.name)}${c.description ? ' — ' + esc(c.description) : ''}</option>`).join('')}
        </select>
        <button class="btn btn--primary" data-act="pick" ${preview ? 'disabled' : ''}>Выбрать</button>
      </div>
      <p class="note note--warn">Выбор окончательный — поменять сможет только админ.</p>
    </div>`;
}

/** Меняет только визуальный предпросмотр; выбор сохраняет отдельная кнопка. */
function bindCharacterPreview(host) {
  const select = host.querySelector('#char-sel');
  if (!select) return;

  select.addEventListener('change', () => {
    const character = state.cache.characters.find(c => c.id === Number(select.value));
    const image = characterImage(character?.name);
    const art = host.querySelector('.hero__art');
    const img = art?.querySelector('img');
    if (!art || !img) return;
    img.src = image;
    img.alt = character?.name || 'Персонаж';
    art.classList.toggle('is-empty', image === PLACEHOLDER_LOGO);
  });
}

const ACTIONS = {
  up: async ({ stat }) => {
    const d = await api('/character/upgrade', 'POST', { stat });
    flash(`Готово. Осталось очков: ${fmtPoints(d.available)}`);
    await renderHero(heroHost);
  },

  pick: async () => {
    await api('/character', 'POST', { character_id: Number(document.querySelector('#char-sel').value) });
    flash('Персонаж выбран');
    await renderHero(heroHost);
  },
};

/** «1 балл», «2 балла», «10 баллов». */
function plural(n) {
  const t = n % 100;
  if (t > 10 && t < 20) return 'баллов';
  const o = n % 10;
  return o === 1 ? 'балл' : o >= 2 && o <= 4 ? 'балла' : 'баллов';
}
