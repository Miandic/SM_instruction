use std::sync::Arc;

use sqlx::SqlitePool;

pub struct Config {
    /// общий код для регистрации старост и студентов (None = регистрация открыта)
    pub registration_code: Option<String>,
    // Организаторы регистрируются по коду своей точки (points.organizer_code),
    // который выдаёт и перегенерирует админ, — общего кода для них нет.
}

#[derive(Clone)]
pub struct AppState {
    /// пул для чтения
    pub db: SqlitePool,
    /// пул из одного соединения — все записи сериализуются через него
    pub db_w: SqlitePool,
    pub cfg: Arc<Config>,
}
