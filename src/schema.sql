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

CREATE TABLE IF NOT EXISTS points (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location    TEXT NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 1
);

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
    created_at INTEGER NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- не больше одной активной брони на команду
CREATE UNIQUE INDEX IF NOT EXISTS one_active_booking_per_group
    ON bookings(group_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS bookings_by_slot ON bookings(slot_id);

CREATE TABLE IF NOT EXISTS score_entries (
    id           INTEGER PRIMARY KEY,
    group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    point_id     INTEGER NOT NULL REFERENCES points(id) ON DELETE CASCADE,
    organizer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    booking_id   INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    points       INTEGER NOT NULL,
    comment      TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS scores_by_group ON score_entries(group_id);
