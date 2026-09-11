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
    migrate(&db_w).await?;
    seed(&db_w).await?;
    Ok((db, db_w))
}

/// Догоняет схему на базах, созданных до появления типов точек и кодов
/// организаторов. На свежей базе всё это уже создано схемой и ничего не делает.
async fn migrate(db: &SqlitePool) -> Result<(), sqlx::Error> {
    add_column(db, "points", "kind", "TEXT NOT NULL DEFAULT 'noc'").await?;
    add_column(db, "points", "organizer_code", "TEXT").await?;
    add_column(db, "points", "logo_url", "TEXT NOT NULL DEFAULT ''").await?;
    add_column(db, "points", "image_urls", "TEXT NOT NULL DEFAULT ''").await?;
    add_column(db, "bookings", "mandatory", "INTEGER NOT NULL DEFAULT 0").await?;
    add_column(db, "score_entries", "kind", "TEXT NOT NULL DEFAULT 'task'").await?;

    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS points_organizer_code
         ON points(organizer_code) WHERE organizer_code IS NOT NULL",
    )
    .execute(db)
    .await?;

    // старый индекс не знал про обязательные точки — пересоздаём
    sqlx::query("DROP INDEX IF EXISTS one_active_booking_per_group")
        .execute(db)
        .await?;
    sqlx::query(
        "CREATE UNIQUE INDEX one_active_booking_per_group
         ON bookings(group_id) WHERE status = 'active' AND mandatory = 0",
    )
    .execute(db)
    .await?;

    // точкам без кода выдаём код, иначе на них некому зарегистрироваться
    let ids: Vec<i64> = sqlx::query_scalar("SELECT id FROM points WHERE organizer_code IS NULL")
        .fetch_all(db)
        .await?;
    for id in &ids {
        sqlx::query("UPDATE points SET organizer_code = ? WHERE id = ?")
            .bind(crate::auth::gen_code())
            .bind(id)
            .execute(db)
            .await?;
    }
    if !ids.is_empty() {
        tracing::info!(
            "выдано кодов организатора: {} (смотреть в админке)",
            ids.len()
        );
    }

    Ok(())
}

async fn add_column(
    db: &SqlitePool,
    table: &str,
    col: &str,
    decl: &str,
) -> Result<(), sqlx::Error> {
    // имя таблицы подставляем в текст запроса: аргумент pragma-функции должен быть
    // литералом. Значения тут свои, из кода ниже, — не пользовательский ввод.
    let present: Option<String> = sqlx::query_scalar(&format!(
        "SELECT name FROM pragma_table_info('{table}') WHERE name = ?"
    ))
    .bind(col)
    .fetch_optional(db)
    .await?;
    if present.is_none() {
        sqlx::query(&format!("ALTER TABLE {table} ADD COLUMN {col} {decl}"))
            .execute(db)
            .await?;
        tracing::info!("миграция: {table}.{col} добавлен");
    }
    Ok(())
}

/// Первоначальные данные: админ, утверждённый список учебных групп и персонажи.
async fn seed(db: &SqlitePool) -> Result<(), sqlx::Error> {
    let now = now_ts();

    let admins: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role = 'admin'")
        .fetch_one(db)
        .await?;
    if admins == 0 {
        let login = std::env::var("ADMIN_LOGIN").unwrap_or_else(|_| "admin".into());
        let password = std::env::var("ADMIN_PASSWORD").unwrap_or_else(|_| "admin".into());
        if password.is_empty() || ["admin", "change-me"].contains(&password.as_str()) {
            tracing::warn!(
                "админ создан с небезопасным паролем-заглушкой — смените ADMIN_PASSWORD"
            );
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
        // Реальный список на 12.09.2026. Названия сохраняются в том виде, в
        // котором показываются при регистрации; «СМ» всегда пишется прописными.
        let groups = [
            ("СМ1-11/4", 1),
            ("СМ1-11/6", 1),
            ("СМ1-12/6", 1),
            ("СМ2-11/6", 2),
            ("СМ3-11/6", 3),
            ("СМ3-12/6", 3),
            ("СМ4-11/6", 4),
            ("СМ4-12/6", 4),
            ("СМ4-13/6", 4),
            ("СМ5-11/5", 5),
            ("СМ5-11/6", 5),
            ("СМ5-12/5", 5),
            ("СМ6-11/6", 6),
            ("СМ6-12/6", 6),
            ("СМ6-19/6", 6),
            ("СМ7-11/6", 7),
            ("СМ7-12/6", 7),
            ("СМ7-13/6", 7),
            ("СМ8-12/6", 8),
            ("СМ9-11/6", 9),
            ("СМ9-12/6", 9),
            ("СМ9-13/6", 9),
            ("СМ9-19/6", 9),
            ("СМ10-11/6", 10),
            ("СМ10-12/6", 10),
            ("СМ10К-11", 10),
            ("СМ11-11/6", 11),
            ("СМ12-11/6", 12),
            ("СМ13-11/4", 13),
            ("СМ13-11/6", 13),
            ("СМ13-12/6", 13),
        ];
        for (name, department) in groups {
            sqlx::query("INSERT INTO groups (name, department, created_at) VALUES (?, ?, ?)")
                .bind(name)
                .bind(department)
                .bind(now)
                .execute(db)
                .await?;
        }
        tracing::info!("создано {} учебных групп", groups.len());
    }

    // Обязательные точки — стартовые данные только для совершенно новой базы.
    // После первого запуска ими управляет админ: удалённые или переименованные
    // точки не должны самопроизвольно появляться снова при рестарте сервера.
    let points: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM points")
        .fetch_one(db)
        .await?;
    if points == 0 {
        for name in ["Экзамен", "Босс", "Администрация"] {
            sqlx::query(
                "INSERT INTO points (name, kind, organizer_code) VALUES (?, 'mandatory', ?)",
            )
            .bind(name)
            .bind(crate::auth::gen_code())
            .execute(db)
            .await?;
            tracing::info!("создана обязательная точка «{name}»");
        }
    }

    let characters: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM characters")
        .fetch_one(db)
        .await?;
    if characters == 0 {
        // заглушки: реальные персонажи и правила прокачки придут от заказчика
        for n in 1..=4 {
            sqlx::query("INSERT INTO characters (name, description) VALUES (?, ?)")
                .bind(format!("Персонаж {n}"))
                .bind("Описание появится позже.")
                .execute(db)
                .await?;
        }
        tracing::info!("создано 4 персонажа-заглушки (Персонаж 1 … Персонаж 4)");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn migrates_legacy_points_with_card_media_fields() {
        let path = std::env::temp_dir().join(format!(
            "sm-instruction-migration-{}.db",
            uuid::Uuid::new_v4()
        ));
        let path_text = path.to_string_lossy().into_owned();

        let legacy = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE points (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                is_active INTEGER NOT NULL DEFAULT 1
            )",
        )
        .execute(&legacy)
        .await
        .unwrap();
        sqlx::query("INSERT INTO points (name, description) VALUES ('НОЦ', 'Описание')")
            .execute(&legacy)
            .await
            .unwrap();
        legacy.close().await;

        let (db, db_w) = init(&path_text).await.unwrap();
        let card: (String, String, String) = sqlx::query_as(
            "SELECT description, logo_url, image_urls FROM points WHERE name = 'НОЦ'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(card, ("Описание".into(), String::new(), String::new()));

        db.close().await;
        db_w.close().await;
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{path_text}{suffix}"));
        }
    }
}
