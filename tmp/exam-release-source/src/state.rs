use sqlx::SqlitePool;

#[derive(Clone)]
pub struct AppState {
    /// пул для чтения
    pub db: SqlitePool,
    /// пул из одного соединения — все записи сериализуются через него
    pub db_w: SqlitePool,
}
