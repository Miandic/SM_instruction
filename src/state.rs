use std::sync::Arc;

use sqlx::SqlitePool;

pub struct Config {
    /// общий код для регистрации старост и студентов (None = регистрация открыта)
    pub registration_code: Option<String>,
    /// код для регистрации организаторов точек
    pub organizer_code: Option<String>,
}

#[derive(Clone)]
pub struct AppState {
    /// пул для чтения
    pub db: SqlitePool,
    /// пул из одного соединения — все записи сериализуются через него
    pub db_w: SqlitePool,
    pub cfg: Arc<Config>,
}
