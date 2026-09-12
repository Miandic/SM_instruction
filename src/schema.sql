CREATE TABLE IF NOT EXISTS characters (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS groups (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,
    department   INTEGER NOT NULL CHECK (department BETWEEN 1 AND 13),
    character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
    created_at   INTEGER NOT NULL
);

-- kind: noc — точка НОЦ (одна оценка за задание)
--       activity — доп. активность (одна оценка за прохождение)
--       mandatory — обязательная точка (без баллов, записывает админ)
CREATE TABLE IF NOT EXISTS points (
    id             INTEGER PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    logo_url       TEXT NOT NULL DEFAULT '',
    -- адреса изображений галереи, по одному в строке
    image_urls     TEXT NOT NULL DEFAULT '',
    location       TEXT NOT NULL DEFAULT '',
    kind           TEXT NOT NULL DEFAULT 'noc' CHECK (kind IN ('noc', 'activity', 'mandatory')),
    -- код, по которому организатор регистрируется именно на эту точку
    organizer_code TEXT,
    is_active      INTEGER NOT NULL DEFAULT 1
);
-- индекс по organizer_code создаёт migrate() в db.rs: на старых базах
-- колонка появляется только после ALTER TABLE

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    login         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'leader', 'student', 'organizer')),
    group_id      INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    point_id      INTEGER REFERENCES points(id) ON DELETE SET NULL,
    created_at    INTEGER NOT NULL
);

-- не больше одного старосты на группу
CREATE UNIQUE INDEX IF NOT EXISTS one_leader_per_group
    ON users(group_id) WHERE role = 'leader';

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS slots (
    id        INTEGER PRIMARY KEY,
    point_id  INTEGER NOT NULL REFERENCES points(id) ON DELETE CASCADE,
    starts_at INTEGER NOT NULL,
    ends_at   INTEGER NOT NULL,
    capacity  INTEGER NOT NULL DEFAULT 1,
    UNIQUE (point_id, starts_at)
);

CREATE TABLE IF NOT EXISTS bookings (
    id         INTEGER PRIMARY KEY,
    slot_id    INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
    group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    -- аудитория обязательного назначения может отличаться у групп в одном слоте
    location   TEXT NOT NULL DEFAULT '',
    -- для заранее назначенной точки время может отличаться у групп одного слота
    scheduled_starts_at INTEGER,
    scheduled_ends_at   INTEGER,
    -- бронь на обязательную точку: назначается заранее и не занимает
    -- единственный слот команды (иначе она не смогла бы записаться никуда ещё)
    mandatory  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- индекс «не больше одной активной брони на команду» создаёт migrate() в db.rs:
-- он опирается на колонку mandatory, которой на старых базах ещё нет

CREATE INDEX IF NOT EXISTS bookings_by_slot ON bookings(slot_id);

-- kind: test — историческая оценка за тест, task — за задание,
--       manual — ручное начисление админом
CREATE TABLE IF NOT EXISTS score_entries (
    id           INTEGER PRIMARY KEY,
    group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    point_id     INTEGER NOT NULL REFERENCES points(id) ON DELETE CASCADE,
    organizer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    booking_id   INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    kind         TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('test', 'task', 'manual')),
    -- SQLite сохраняет здесь как целые оценки организатора, так и ручные
    -- начисления администратора с шагом 0,5.
    points       REAL NOT NULL,
    comment      TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS scores_by_group ON score_entries(group_id);

-- Прокачка персонажа: строка на каждую характеристику команды.
-- Ключи характеристик — STAT_KEYS в models.rs, подписи — в static/content.js.
CREATE TABLE IF NOT EXISTS group_stats (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    stat     TEXT NOT NULL,
    value    INTEGER NOT NULL DEFAULT 0,
    -- сколько баллов списано; при правиле 1:1 равно value
    spent    INTEGER NOT NULL DEFAULT 0,
    -- момент последнего повышения этой характеристики
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_id, stat)
);
