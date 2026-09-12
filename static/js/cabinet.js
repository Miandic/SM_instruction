/* Личный кабинет: точки и слоты, моя команда, рейтинг, кабинет организатора,
   админка. Разметка мобильная — таблицы остались только в админке. */

import {
  $, api, apiForm, ask, askText, esc, state, flash, fmtT, fmtDT, fmtPoints, nums,
  ROLE_LABELS, roleLabel, STATUS_LABELS, KIND_LABELS, SCORE_KIND_LABELS,
  bindActions, bindForms,
} from './core.js';
import { bookingCtx, slotChips } from './slots.js';

const RENDERERS = {};
let current = 'points';
let refreshTimer = null;

function tabsFor(me) {
  const tabs = [];
  if (me.role !== 'organizer') tabs.push(['points', 'Точки']);
  if (me.group_id) tabs.push(['team', 'Моя команда']);
  tabs.push(['rating', 'Рейтинг']);
  if (me.role === 'organizer') tabs.push(['org', 'Моя точка']);
  if (me.role === 'admin') tabs.push(['progression', 'Прокачка']);
  if (me.role === 'admin') tabs.push(['admin', 'Админка']);
  return tabs;
}

export async function renderCabinet(host, tab) {
  const tabs = tabsFor(state.me);
  current = tabs.some(([id]) => id === tab) ? tab : tabs[0][0];

  host.innerHTML = `
    <nav class="tabs">
      ${tabs.map(([id, label]) =>
        `<a class="tab ${id === current ? 'is-active' : ''}" href="#/app/${id}">${label}</a>`).join('')}
    </nav>
    <div class="wrap section" id="tabview"></div>`;

  bindActions(host, ACTIONS);
  bindForms(host, FORMS);

  await renderTab();

  // сетки без форм можно тихо обновлять, не сбивая ввод
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (state.me && (current === 'points' || current === 'rating')) renderTab().catch(() => {});
  }, 20000);
}

export function stopCabinet() {
  clearInterval(refreshTimer);
  refreshTimer = null;
}

async function renderTab() {
  const host = $('#tabview');
  if (!host) return;
  host.innerHTML = await RENDERERS[current]();
  bindScoreSliders(host);
}

function bindScoreSliders(host) {
  host.querySelectorAll('[data-score-slider]').forEach(input => {
    const output = document.getElementById(input.dataset.scoreOutput);
    if (!output) return;
    input.addEventListener('input', () => { output.value = input.value; });
  });
}

const reload = () => renderTab();

// ---------- точки и слоты ----------

RENDERERS.points = async () => {
  const [points, slots, myBookings] = await Promise.all([
    api('/points'), api('/slots'),
    state.me.group_id ? api('/bookings/my') : [],
  ]);
  state.cache.points = points;

  const now = Date.now() / 1000;
  const byPoint = {};
  for (const s of slots) (byPoint[s.point_id] ??= []).push(s);

  // правила бекенда: точку дважды не проходят, одна активная бронь на команду
  const ctx = bookingCtx(myBookings);
  const active = ctx.active;

  const notice = active ? `
    <div class="notice">
      <span class="notice__dot"></span>
      <div>
        <b>Активная бронь: ${esc(active.point_name)}</b>
        <span>${fmtDT(active.starts_at)}–${fmtT(active.ends_at)}${state.me.role === 'leader'
          ? '. Новую точку можно занять после завершения или отмены этой.' : '.'}</span>
        ${state.me.role === 'leader' ? `
          <div class="notice__actions">
            <button class="btn btn--sm btn--danger" data-act="cancel-booking" data-id="${active.id}">
              Отменить бронь
            </button>
          </div>` : ''}
      </div>
    </div>` : '';

  if (!points.length) return notice + empty('Точки ещё не добавлены.');

  return notice + `<div class="stack">` + points.map(p => {
    const badge = ctx.completed.has(p.id) ? `<span class="badge badge--done">пройдена</span>`
      : active?.point_id === p.id ? `<span class="badge badge--current">активная бронь</span>` : '';
    const chips = p.kind === 'mandatory' ? '' : slotChips(byPoint[p.id] || [], p, ctx, now);
    return `
      <article class="card">
        <header class="card__head">
          <h3>${esc(p.name)}</h3>
          <span class="badge">${KIND_LABELS[p.kind] || esc(p.kind)}</span>${badge}
        </header>
        ${p.location ? `<p class="card__meta">${esc(p.location)}</p>` : ''}
        ${p.description ? `<p class="card__text">${esc(p.description)}</p>` : ''}
        ${p.kind === 'mandatory'
          ? '<p class="note">Обязательная точка — время назначают организаторы, баллы не начисляются.</p>'
          : ''}
        ${chips}
      </article>`;
  }).join('') + `</div>`;
};

// ---------- моя команда ----------

RENDERERS.team = async () => {
  const d = await api('/groups/' + state.me.group_id);
  const g = d.group;

  let charBlock;
  if (g.character_name) {
    charBlock = `
      <div class="hero-stat">
        <div>
          <span class="hero-stat__label">Персонаж</span>
          <span class="hero-stat__value">${esc(g.character_name)}</span>
        </div>
        <div>
          <span class="hero-stat__label">Уровень</span>
          <span class="hero-stat__value">${g.level}</span>
        </div>
        <div>
          <span class="hero-stat__label">Баллы</span>
          <span class="hero-stat__value">${fmtPoints(g.total_points)}</span>
        </div>
      </div>`;
  } else if (state.me.role === 'leader') {
    if (!state.cache.characters.length) state.cache.characters = await api('/characters');
    charBlock = `
      <p class="card__text">Персонаж ещё не выбран.</p>
      <div class="inline-form">
        <select id="char-sel" aria-label="Персонаж">
          ${state.cache.characters.map(c =>
            `<option value="${c.id}">${esc(c.name)} — ${esc(c.description)}</option>`).join('')}
        </select>
        <button class="btn btn--primary" data-act="pick-char">Выбрать</button>
      </div>
      <p class="note note--warn">Выбор окончательный — поменять сможет только админ.</p>`;
  } else {
    charBlock = `<p class="note">Персонаж ещё не выбран старостой. Баллы команды: ${fmtPoints(g.total_points)}.</p>`;
  }

  const bookings = d.bookings.length ? `<div class="list">` + d.bookings.map(b => `
    <div class="item">
      <div class="item__head">
        <b>${esc(b.point_name)}</b>
        <span class="status status--${b.status}">${STATUS_LABELS[b.status]}</span>
      </div>
      <div class="item__meta">${fmtDT(b.starts_at)}–${fmtT(b.ends_at)}${
        b.location ? ` · ${esc(b.location)}` : ''}${
        b.mandatory ? ' · назначено организаторами' : ''}</div>
      ${b.status === 'active' && state.me.role === 'leader' && !b.mandatory
        ? `<div class="item__actions">
             <button class="btn btn--sm btn--danger" data-act="cancel-booking" data-id="${b.id}">Отменить бронь</button>
           </div>` : ''}
    </div>`).join('') + `</div>`
    : empty('Броней пока нет. Староста может занять слот на вкладке «Точки».');

  const scores = d.scores.length ? `<div class="list">` + d.scores.map(s => `
    <div class="item">
      <div class="item__head">
        <b>${esc(s.point_name)}</b>
        <span class="points">+${fmtPoints(s.points)}</span>
      </div>
      <div class="item__meta">${SCORE_KIND_LABELS[s.kind] || esc(s.kind)} · ${fmtDT(s.created_at)}${
        s.organizer_name ? ' · ' + esc(s.organizer_name) : ''}</div>
      ${s.comment ? `<p class="item__text">${esc(s.comment)}</p>` : ''}
    </div>`).join('') + `</div>`
    : empty('Баллов пока нет.');

  return `
    <div class="stack">
      <article class="card card--accent">
        <header class="card__head">
          <h3>${esc(g.name)}</h3>
          <span class="badge">кафедра СМ${g.department}</span>
        </header>
        ${charBlock}
      </article>
      <section>${sectionHead('Брони')}${bookings}</section>
      <section>${sectionHead('Баллы')}${scores}</section>
    </div>`;
};

// ---------- рейтинг ----------

RENDERERS.rating = async () => {
  const rows = await api('/rating');
  if (!rows.length) return empty('Команд пока нет.');

  return `
    <div class="stack">
      ${sectionHead('Рейтинг команд')}
      <ol class="rank">
        ${rows.map((r, i) => `
          <li class="rank__row ${r.id === state.me.group_id ? 'is-me' : ''}">
            <span class="rank__place ${i < 3 ? 'is-top' : ''}">${i + 1}</span>
            <span class="rank__body">
              <span class="rank__name">${esc(r.name)}</span>
              <span class="rank__meta">СМ${r.department} · ${esc(r.character_name ?? 'без персонажа')}</span>
            </span>
            <span class="rank__stats">
              <span class="rank__points">${fmtPoints(r.total_points)}</span>
              <span class="rank__level">ур. ${r.level}</span>
            </span>
          </li>`).join('')}
      </ol>
    </div>`;
};

// ---------- организатор ----------

RENDERERS.org = async () => {
  // точку организатору назначает админ уже после регистрации
  if (!state.me.point_id) {
    return empty('Точка пока не назначена — обратитесь к администратору.');
  }

  const [point, rows] = await Promise.all([
    api('/points/' + state.me.point_id),
    api('/organizer/bookings'),
  ]);

  // У НОЦ и активностей единая оценка за задание; обязательные точки — без баллов.
  const needTask = point.kind !== 'mandatory';

  const scoreSlider = id => `
    <label class="scorefield">
      <span class="scorefield__head">За задание <output id="${id}-value" for="${id}">10</output></span>
      <input type="range" id="${id}" value="10" min="0" max="10" step="1"
             aria-label="Баллы за задание" aria-describedby="${id}-value"
             data-score-slider data-score-output="${id}-value">
    </label>`;

  const done = b => [
    b.test_points != null ? `тест +${b.test_points}` : '',
    b.task_points != null ? `прохождение +${b.task_points}` : '',
  ].filter(Boolean).join(' · ') || 'без баллов';

  const list = rows.length ? `<div class="list">` + rows.map(b => `
    <div class="item">
      <div class="item__head">
        <b>${esc(b.group_name)}</b>
        <span class="status status--${b.status}">${STATUS_LABELS[b.status]}</span>
      </div>
      <div class="item__meta">${fmtDT(b.starts_at)}–${fmtT(b.ends_at)}${
        b.location ? ` · ${esc(b.location)}` : ''}</div>
      ${b.status === 'active' ? `
        <div class="inline-form">
          ${needTask ? scoreSlider(`task-${b.id}`) : ''}
          <input id="cmt-${b.id}" placeholder="Комментарий" aria-label="Комментарий">
          <button class="btn btn--primary" data-act="complete" data-id="${b.id}"
                  data-task="${needTask}">
            ${needTask ? 'Завершить' : 'Отметить'}
          </button>
        </div>`
        : `<div class="item__meta"><span class="points">${done(b)}</span></div>`}
    </div>`).join('') + `</div>`
    : empty('Записей на вашу точку пока нет.');

  return `
    <div class="stack">
      <div class="section__row">
        <h2 class="section__head">Точка «${esc(point.name)}»</h2>
        <button class="btn btn--sm" data-act="refresh">Обновить</button>
      </div>
      <p class="note">${KIND_LABELS[point.kind] || esc(point.kind)}${
        point.kind === 'noc' ? ' — одна оценка за задание.'
          : point.kind === 'activity' ? ' — одна оценка за задание.'
            : ' — баллы не начисляются, только отметка о посещении.'}</p>
      ${list}
    </div>`;
};

// ---------- админка ----------

const progressionHeaders = [
  'Группа / персонаж', 'Всего очков', 'Нераспределённые очки',
  'Мужество', 'Воля', 'Труд', 'Упорство', 'Время последнего обновления',
];

const tsvCell = value => String(value ?? '').replace(/[\t\r\n]+/g, ' ');
const progressionCharacter = row => `${row.group_name} — ${row.character_name ?? '—'}`;

function progressionTsv(rows) {
  return [progressionHeaders, ...rows.map(row => [
    progressionCharacter(row), fmtPoints(row.total_points), fmtPoints(row.available_points),
    row.courage, row.will, row.labor, row.persistence,
    row.updated_at ? fmtDT(row.updated_at) : '—',
  ])].map(row => row.map(tsvCell).join('\t')).join('\n');
}

RENDERERS.progression = async () => {
  const rows = await api('/admin/progression');
  const copyText = progressionTsv(rows);

  return `
    <div class="stack">
      <article class="card">
        ${sectionHead('Прокачка групп')}
        <p class="note">Таблица показывает актуальные значения. Последнее обновление — последнее начисление баллов или повышение характеристики.</p>
        ${rows.length ? `<div class="tablewrap"><table class="progression-table">
          <tr>${progressionHeaders.map(header => `<th>${header}</th>`).join('')}</tr>
          ${rows.map(row => `<tr>
            <td>${esc(progressionCharacter(row))}</td>
            <td>${fmtPoints(row.total_points)}</td>
            <td>${fmtPoints(row.available_points)}</td>
            <td>${row.courage}</td>
            <td>${row.will}</td>
            <td>${row.labor}</td>
            <td>${row.persistence}</td>
            <td class="nowrap">${row.updated_at ? fmtDT(row.updated_at) : '—'}</td>
          </tr>`).join('')}
        </table></div>` : empty('Групп пока нет.')}
      </article>
      <article class="card progression-copy">
        <div class="card__head">
          <h3>Копируемый список</h3>
          <button class="btn btn--primary" data-act="copy-progression">Копировать</button>
        </div>
        <textarea id="progression-copy" rows="${Math.min(12, Math.max(3, rows.length + 1))}" readonly
                  aria-label="Прокачка групп в формате для копирования">${esc(copyText)}</textarea>
        <p class="note">Столбцы разделены табуляцией: при вставке в таблицу они попадут в отдельные ячейки.</p>
      </article>
    </div>`;
};

RENDERERS.admin = async () => {
  const [points, groups, users, bookings, scores, characters, slots, rating] = await Promise.all([
    api('/admin/points'), api('/groups'), api('/admin/users'),
    api('/admin/bookings'), api('/admin/scores'), api('/characters'), api('/slots'), api('/rating'),
  ]);
  state.cache.points = points;
  state.cache.groups = groups;

  const pointOpts = points.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const groupOpts = groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  const pointName = Object.fromEntries(points.map(p => [p.id, p.name]));
  const charByGroup = Object.fromEntries(rating.map(r => [r.id, r.character_name]));
  const slotsByPoint = {};
  for (const s of slots) (slotsByPoint[s.point_id] ??= []).push(s);

  return `
    <div class="stack">
      <div class="preview-cta">
        <div><b>Проверка пользовательского экрана</b>
          <span>Посмотрите интерфейс глазами старосты выбранной группы без изменения данных.</span></div>
        <a class="btn btn--primary" href="#/preview">Предпросмотр старосты</a>
      </div>
      <article class="card">
        ${sectionHead('Точки')}
        <div class="tablewrap"><table>
          <tr><th>Название</th><th>Тип</th><th>Где</th><th>Код организатора</th><th>Активна</th><th></th></tr>
          ${points.map(p => `
            <tr>
              <td>${esc(p.name)}</td>
              <td class="nowrap">
                <select id="pt-kind-${p.id}">
                  ${Object.entries(KIND_LABELS).map(([k, l]) =>
                    `<option value="${k}" ${k === p.kind ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
                <button class="btn btn--sm" data-act="point-kind" data-id="${p.id}">OK</button>
              </td>
              <td>${esc(p.location)}</td>
              <td class="nowrap">
                <code class="code">${esc(p.organizer_code ?? '—')}</code>
                <button class="btn btn--sm" data-act="regen-code" data-id="${p.id}"
                        data-name="${esc(p.name)}" title="Выдать новый код">Обновить</button>
              </td>
              <td>${p.is_active ? 'да' : 'нет'}</td>
              <td class="nowrap">
                <button class="btn btn--sm" data-act="point-toggle" data-id="${p.id}" data-active="${!p.is_active}">
                  ${p.is_active ? 'Выключить' : 'Включить'}</button>
                <button class="btn btn--sm btn--danger" data-act="del"
                        data-path="/admin/points/${p.id}" data-what="точку со всеми её слотами">Удалить</button>
              </td>
            </tr>
            <tr class="point-editor-row">
              <td colspan="6">
                <details>
                  <summary>Карточка: название, описание и изображения</summary>
                  <form data-form="edit-point" data-id="${p.id}" class="point-editor">
                    <label class="field"><span>Название</span>
                      <input name="name" value="${esc(p.name)}" required></label>
                    <label class="field"><span>Место</span>
                      <input name="location" value="${esc(p.location)}"></label>
                    <label class="field point-editor__wide"><span>Описание</span>
                      <textarea name="description" rows="4">${esc(p.description)}</textarea></label>
                    <label class="field point-editor__wide"><span>Логотип (URL или путь вида /img/logo.svg)</span>
                      <input name="logo_url" value="${esc(p.logo_url)}" placeholder="/img/placeholder-logo.svg"></label>
                    <label class="field point-editor__wide"><span>Или загрузить логотип с устройства</span>
                      <input name="logo_file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label>
                    <label class="field point-editor__wide"><span>Изображения галереи — по одному URL в строке</span>
                      <textarea name="image_urls" rows="3" placeholder="/img/photo-1.jpg">${esc(p.image_urls)}</textarea></label>
                    <label class="field point-editor__wide"><span>Добавить фотографии с устройства</span>
                      <input name="image_files" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple></label>
                    ${p.logo_url ? `<span class="upload-preview point-editor__wide">
                      <img src="${esc(p.logo_url)}" alt="Текущий логотип"><span>Текущий логотип</span></span>` : ''}
                    <button class="btn btn--primary">Сохранить карточку</button>
                  </form>
                </details>
              </td>
            </tr>`).join('')}
        </table></div>
        <form data-form="create-point" class="inline-form">
          <input name="name" placeholder="Название" required>
          <select name="kind">
            ${Object.entries(KIND_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
          </select>
          <input name="location" placeholder="Где находится">
          <input name="description" placeholder="Описание">
          <input name="logo_url" placeholder="URL логотипа">
          <label class="file-pick"><span>Логотип с устройства</span>
            <input name="logo_file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label>
          <textarea name="image_urls" rows="2" placeholder="URL изображений, по одному в строке"></textarea>
          <label class="file-pick"><span>Фотографии с устройства</span>
            <input name="image_files" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple></label>
          <button class="btn btn--primary">Добавить</button>
        </form>
        <p class="note">Организатор регистрируется по коду своей точки — код определяет,
          какую точку он ведёт. Если код утёк, нажмите «Обновить»: уже заведённые
          организаторы останутся на точке, а старый код перестанет работать.</p>
      </article>

      <article class="card">
        ${sectionHead('Слоты')}
        ${points.map(p => `
          <div class="slotrow">
            <b>${esc(p.name)}</b>
            <div class="slots slots--dense">${(slotsByPoint[p.id] || []).map(s => `
              <span class="slot slot--mini ${s.booked ? 'slot--full' : ''}">
                <span class="slot__time">${fmtDT(s.starts_at)}</span>
                <span class="slot__state">${s.booked}/${s.capacity}</span>
                <button class="btn btn--icon btn--danger btn--sm" title="Удалить слот"
                        data-act="del" data-path="/admin/slots/${s.id}" data-what="слот">×</button>
              </span>`).join('') || '<span class="note">нет слотов</span>'}</div>
          </div>`).join('')}
        <form data-form="gen-slots" class="inline-form">
          <select name="point_id" required>${pointOpts}</select>
          <input name="first_start" type="datetime-local" required>
          <input name="slot_minutes" type="number" value="20" min="1" class="w-num" title="длительность, минут">
          <input name="count" type="number" value="10" min="1" max="200" class="w-num" title="количество слотов">
          <input name="break_minutes" type="number" value="0" min="0" class="w-num" title="перерыв, минут">
          <input name="capacity" type="number" value="1" min="1" class="w-num" title="команд на слот">
          <button class="btn btn--primary">Сгенерировать</button>
        </form>
        <p class="note">Поля по порядку: точка / начало / длительность / количество / перерыв / вместимость.</p>
      </article>

      <article class="card">
        ${sectionHead('Группы')}
        <div class="tablewrap"><table>
          <tr><th>Группа</th><th>Кафедра</th><th>Староста</th><th>Персонаж</th><th></th></tr>
          ${groups.map(g => `
            <tr>
              <td class="nowrap">${esc(g.name)}
                <button class="btn btn--icon btn--sm" title="Переименовать"
                        data-act="rename-group" data-id="${g.id}" data-name="${esc(g.name)}">✎</button></td>
              <td>СМ${g.department}</td>
              <td>${g.has_leader ? 'есть' : '—'}</td>
              <td class="nowrap">
                <select id="grp-char-${g.id}">
                  <option value="">—</option>
                  ${characters.map(c => `<option value="${c.id}" ${c.name === charByGroup[g.id] ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
                </select>
                <button class="btn btn--sm" data-act="group-char" data-id="${g.id}">OK</button>
              </td>
              <td><button class="btn btn--sm btn--danger" data-act="del"
                          data-path="/admin/groups/${g.id}" data-what="группу со всеми бронями и баллами">Удалить</button></td>
            </tr>`).join('')}
        </table></div>
        <form data-form="create-group" class="inline-form">
          <input name="name" placeholder="Название (СМ1-12)" required>
          <input name="department" type="number" min="1" max="13" placeholder="Кафедра" class="w-num" required>
          <button class="btn btn--primary">Добавить</button>
        </form>
      </article>

      <article class="card">
        ${sectionHead('Пользователи')}
        <div class="tablewrap"><table>
          <tr><th>Логин</th><th>Имя</th><th>Роль</th><th>Группа / точка</th><th></th></tr>
          ${users.map(u => u.id === state.me.id ? `
            <tr class="is-me">
              <td>${esc(u.login)}</td>
              <td>${esc(u.display_name)}</td>
              <td>${esc(roleLabel(u))}</td>
              <td>${esc(u.group_name ?? u.point_name ?? '—')}</td>
              <td><button class="btn btn--sm" data-act="reset-pw" data-id="${u.id}"
                          data-login="${esc(u.login)}">Сменить пароль</button></td>
            </tr>` : `
            <tr>
              <td>${esc(u.login)}</td>
              <td class="nowrap">${esc(u.display_name)}
                <button class="btn btn--icon btn--sm" title="Изменить имя"
                        data-act="rename-user" data-id="${u.id}" data-name="${esc(u.display_name)}">✎</button></td>
              <td>
                <select id="usr-role-${u.id}">
                  ${Object.entries(ROLE_LABELS).map(([r, l]) =>
                    `<option value="${r}" ${r === u.role ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
              </td>
              <td class="nowrap">
                <select id="usr-grp-${u.id}" title="Группа">
                  <option value="">без группы</option>
                  ${groups.map(g => `<option value="${g.id}" ${g.id === u.group_id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
                </select>
                <select id="usr-pt-${u.id}" title="Точка">
                  <option value="">без точки</option>
                  ${points.map(p => `<option value="${p.id}" ${p.id === u.point_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                </select>
              </td>
              <td class="nowrap">
                <button class="btn btn--sm" data-act="save-user" data-id="${u.id}">Сохранить</button>
                <button class="btn btn--sm" data-act="reset-pw" data-id="${u.id}" data-login="${esc(u.login)}">Пароль</button>
                <button class="btn btn--sm btn--danger" data-act="del"
                        data-path="/admin/users/${u.id}" data-what="пользователя">Удалить</button>
              </td>
            </tr>`).join('')}
        </table></div>
      </article>

      <article class="card">
        ${sectionHead('Брони')}
        ${bookings.length ? `<div class="tablewrap"><table>
          <tr><th>Время</th><th>Команда</th><th>Точка</th><th>Статус</th><th></th></tr>
          ${bookings.map(b => `
            <tr>
              <td class="nowrap">${fmtDT(b.starts_at)}${b.location ? `<br>${esc(b.location)}` : ''}</td>
              <td>${esc(b.group_name)}</td>
              <td class="nowrap">${esc(b.point_name)}${
                b.mandatory ? ' <span class="badge">назначена</span>' : ''}</td>
              <td><span class="status status--${b.status}">${STATUS_LABELS[b.status]}</span></td>
              <td>${b.status === 'active'
                ? `<button class="btn btn--sm btn--danger" data-act="cancel-booking-admin" data-id="${b.id}">Отменить</button>`
                : ''}</td>
            </tr>`).join('')}
        </table></div>` : empty('Броней нет.')}
        <form data-form="create-booking" class="inline-form">
          <select name="slot_id" required>
            ${slots.map(s => `<option value="${s.id}">${esc(pointName[s.point_id] ?? '?')} — ${fmtDT(s.starts_at)} (${s.booked}/${s.capacity})</option>`).join('')}
          </select>
          <select name="group_id" required>${groupOpts}</select>
          <button class="btn btn--primary">Создать бронь</button>
        </form>
        <p class="note note--warn">Ручная бронь идёт в обход окна 15 минут и лимита одной активной брони, но не в обход вместимости слота.</p>
        <p class="note">Бронь на обязательную точку (экзамен, босс, администрация) помечается
          «назначена»: она не занимает лимит одной активной брони и команда не может её отменить.
          Чтобы перенести время — отмените её здесь и создайте на другом слоте.</p>
      </article>

      <article class="card">
        ${sectionHead('Баллы')}
        ${scores.length ? `<div class="tablewrap"><table>
          <tr><th>Когда</th><th>Команда</th><th>Точка</th><th>За что</th><th>Баллы</th><th>Кто начислил</th><th></th></tr>
          ${scores.map(s => `
            <tr>
              <td class="nowrap">${fmtDT(s.created_at)}</td>
              <td>${esc(s.group_name)}</td>
              <td>${esc(s.point_name)}</td>
              <td>${SCORE_KIND_LABELS[s.kind] || esc(s.kind)}</td>
              <td><span class="points">+${fmtPoints(s.points)}</span></td>
              <td>${esc(s.organizer_name ?? '—')}</td>
              <td><button class="btn btn--sm btn--danger" data-act="del"
                          data-path="/admin/scores/${s.id}" data-what="начисление">Удалить</button></td>
            </tr>`).join('')}
        </table></div>` : empty('Начислений нет.')}
        <form data-form="create-score" class="inline-form">
          <select name="group_id" required>${groupOpts}</select>
          <select name="point_id" required>${pointOpts}</select>
          <input name="points" type="number" step="0.5" placeholder="Баллы" class="w-num" required>
          <input name="comment" placeholder="Комментарий">
          <button class="btn btn--primary">Начислить</button>
        </form>
      </article>

      <article class="card">
        ${sectionHead('Персонажи')}
        <div class="list">
          ${characters.map(c => `
            <div class="item">
              <div class="item__head">
                <b>${esc(c.name)}</b>
                <button class="btn btn--sm btn--danger" data-act="del"
                        data-path="/admin/characters/${c.id}" data-what="персонажа">Удалить</button>
              </div>
              ${c.description ? `<p class="item__text">${esc(c.description)}</p>` : ''}
            </div>`).join('')}
        </div>
        <form data-form="create-character" class="inline-form">
          <input name="name" placeholder="Имя" required>
          <input name="description" placeholder="Описание">
          <button class="btn btn--primary">Добавить</button>
        </form>
      </article>
    </div>`;
};

// ---------- действия ----------

async function cancelBooking({ id }) {
  if (!await ask('Отменить бронь?', { ok: 'Отменить бронь', cancel: 'Оставить', danger: true })) return;
  await api('/bookings/' + id, 'DELETE');
  flash('Бронь отменена');
  await reload();
}

const ACTIONS = {
  refresh: () => reload(),

  'copy-progression': async () => {
    const field = $('#progression-copy');
    if (!field) return;
    field.focus();
    field.select();
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(field.value);
    } else if (!document.execCommand('copy')) {
      throw new Error('не удалось скопировать список');
    }
    flash('Список скопирован');
  },

  book: async ({ id }) => {
    await api('/bookings', 'POST', { slot_id: Number(id) });
    flash('Слот забронирован');
    await reload();
  },

  'pick-char': async () => {
    await api('/character', 'POST', { character_id: Number($('#char-sel').value) });
    flash('Персонаж выбран');
    await reload();
  },

  'cancel-booking': cancelBooking,
  // блок слота со своей бронью шлёт `cancel` — разметку рисует общий slots.js
  cancel: cancelBooking,

  complete: async ({ id, task }) => {
    const body = { booking_id: Number(id), comment: $('#cmt-' + id).value };
    if (task === 'true') body.task_points = Number($('#task-' + id).value);
    const d = await api('/organizer/complete', 'POST', body);
    flash(d.points ? `Визит завершён, начислено ${fmtPoints(d.points)} баллов` : 'Визит отмечен');
    await reload();
  },

  del: async ({ path, what }) => {
    if (!await ask(`Удалить ${what}? Это действие необратимо.`, { ok: 'Удалить', danger: true })) return;
    await api(path, 'DELETE');
    flash('Удалено');
    await reload();
  },

  'point-toggle': async ({ id, active }) => {
    await api('/admin/points/' + id, 'PATCH', { is_active: active === 'true' });
    await reload();
  },

  'point-kind': async ({ id }) => {
    await api('/admin/points/' + id, 'PATCH', { kind: $('#pt-kind-' + id).value });
    flash('Тип точки изменён');
    await reload();
  },

  'regen-code': async ({ id, name }) => {
    if (!await ask(`Выдать новый код для точки «${name}»? Старый перестанет работать.`,
      { ok: 'Выдать новый', danger: true })) return;
    const d = await api('/admin/points/' + id + '/code', 'POST', {});
    flash(`Новый код: ${d.organizer_code}`);
    await reload();
  },

  'rename-group': async ({ id, name }) => {
    const v = await askText('Новое название группы:', { value: name });
    if (!v || v === name) return;
    await api('/admin/groups/' + id, 'PATCH', { name: v });
    flash('Сохранено');
    await reload();
  },

  'group-char': async ({ id }) => {
    const v = $('#grp-char-' + id).value;
    await api('/admin/groups/' + id, 'PATCH', { character_id: v ? Number(v) : null });
    flash('Сохранено');
    await reload();
  },

  'save-user': async ({ id }) => {
    const g = $('#usr-grp-' + id).value;
    const p = $('#usr-pt-' + id).value;
    await api('/admin/users/' + id, 'PATCH', {
      role: $('#usr-role-' + id).value,
      group_id: g ? Number(g) : null,
      point_id: p ? Number(p) : null,
    });
    flash('Сохранено');
    await reload();
  },

  'rename-user': async ({ id, name }) => {
    const v = await askText('Новое имя:', { value: name });
    if (!v || v === name) return;
    await api('/admin/users/' + id, 'PATCH', { display_name: v });
    flash('Имя изменено');
    await reload();
  },

  'reset-pw': async ({ id, login }) => {
    const password = await askText(`Новый пароль для ${login} (мин. 6 символов):`,
      { type: 'password', ok: 'Сменить пароль' });
    if (!password) return;
    await api('/admin/users/' + id, 'PATCH', { password });
    flash('Пароль изменён');
  },

  'cancel-booking-admin': async ({ id }) => {
    await api('/admin/bookings/' + id, 'PATCH', { status: 'cancelled' });
    flash('Бронь отменена');
    await reload();
  },
};

const created = async (path, body) => {
  await api(path, 'POST', body);
  flash('Добавлено');
  await reload();
};

async function uploadFile(file) {
  const body = new FormData();
  body.append('image', file);
  return (await apiForm('/admin/uploads', body)).url;
}

async function pointFormData(fields, form) {
  delete fields.logo_file;
  delete fields.image_files;

  const logo = form.elements.logo_file?.files?.[0];
  const images = [...(form.elements.image_files?.files || [])];
  if (logo || images.length) flash('Загружаем изображения…');
  if (logo) fields.logo_url = await uploadFile(logo);
  if (images.length) {
    const uploaded = await Promise.all(images.map(uploadFile));
    fields.image_urls = [fields.image_urls.trim(), ...uploaded].filter(Boolean).join('\n');
  }
  return fields;
}

const FORMS = {
  'create-point': async (f, form) => created('/admin/points', await pointFormData(f, form)),
  'edit-point': async (f, form) => {
    await api('/admin/points/' + form.dataset.id, 'PATCH', await pointFormData(f, form));
    flash('Карточка сохранена');
    await reload();
  },
  'create-group': f => created('/admin/groups', nums(f, 'department')),
  'create-score': f => created('/admin/scores', nums(f, 'group_id', 'point_id', 'points')),
  'create-character': f => created('/admin/characters', f),
  'create-booking': f => created('/admin/bookings', nums(f, 'slot_id', 'group_id')),

  'gen-slots': async f => {
    const d = await api('/admin/slots', 'POST', {
      point_id: Number(f.point_id),
      first_start: new Date(f.first_start).toISOString(),
      slot_minutes: Number(f.slot_minutes),
      count: Number(f.count),
      break_minutes: Number(f.break_minutes) || 0,
      capacity: Number(f.capacity) || 1,
    });
    flash(`Создано слотов: ${d.created.length}`);
    await reload();
  },
};

// ---------- мелкие помощники разметки ----------

const empty = text => `<p class="note note--empty">${esc(text)}</p>`;

const sectionHead = title => `<h2 class="section__head">${esc(title)}</h2>`;
