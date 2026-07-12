use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::auth::hash_password;
use crate::models::now_ts;

const SCHEMA: &str = include_str!("schema.sql");

pub async fn init(path: &str) -> Result<(SqlitePool, SqlitePool), sqlx::Error> {
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5))
        .foreign_keys(true);

    let db = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(opts.clone())
        .await?;
    let db_w = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;

    sqlx::raw_sql(SCHEMA).execute(&db_w).await?;
    seed(&db_w).await?;
    Ok((db, db_w))
}

/// Первоначальные данные: админ, персонажи, по одной группе на кафедру.
async fn seed(db: &SqlitePool) -> Result<(), sqlx::Error> {
    let now = now_ts();

    let admins: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role = 'admin'")
        .fetch_one(db)
        .await?;
    if admins == 0 {
        let login = std::env::var("ADMIN_LOGIN").unwrap_or_else(|_| "admin".into());
        let password = std::env::var("ADMIN_PASSWORD").unwrap_or_else(|_| "admin".into());
        if password == "admin" {
            tracing::warn!("админ создан с паролем по умолчанию (admin/admin) — смените через ADMIN_PASSWORD");
        }
        let hash = hash_password(&password).expect("hash admin password");
        sqlx::query(
            "INSERT INTO users (login, display_name, password_hash, role, created_at)
             VALUES (?, 'Администратор', ?, 'admin', ?)",
        )
        .bind(&login)
        .bind(&hash)
        .bind(now)
        .execute(db)
        .await?;
        tracing::info!("создан админ '{login}'");
    }

    let groups: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM groups")
        .fetch_one(db)
        .await?;
    if groups == 0 {
        for dep in 1..=13 {
            sqlx::query("INSERT INTO groups (name, department, created_at) VALUES (?, ?, ?)")
                .bind(format!("СМ{dep}-11"))
                .bind(dep)
                .bind(now)
                .execute(db)
                .await?;
        }
        tracing::info!("создано 13 групп-заглушек (СМ1-11 … СМ13-11), реальный список зальём позже");
    }

    let characters: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM characters")
        .fetch_one(db)
        .await?;
    if characters == 0 {
        let defaults = [
            ("Инженер", "Мастер на все руки: чинит, собирает, выкручивается."),
            ("Учёный", "Знает ответ на всё, а если не знает — выведет формулу."),
            ("Разведчик", "Первым находит путь и замечает то, что скрыто."),
            ("Медик", "Держит команду в строю в любой ситуации."),
        ];
        for (name, desc) in defaults {
            sqlx::query("INSERT INTO characters (name, description) VALUES (?, ?)")
                .bind(name)
                .bind(desc)
                .execute(db)
                .await?;
        }
        tracing::info!("создан стартовый набор персонажей");
    }

    Ok(())
}
