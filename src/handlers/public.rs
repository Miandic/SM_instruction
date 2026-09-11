use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{AuthUser, ROLE_LEADER};
use crate::error::{ApiError, ApiResult};
use crate::models::*;
use crate::state::AppState;

pub async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

/// Список групп — публичный, нужен форме регистрации.
pub async fn groups(State(state): State<AppState>) -> ApiResult<Json<Vec<GroupBrief>>> {
    let rows = sqlx::query_as::<_, GroupBrief>(
        "SELECT g.id, g.name, g.department,
                EXISTS(SELECT 1 FROM users u WHERE u.group_id = g.id AND u.role = 'leader') AS has_leader
         FROM groups g ORDER BY g.department, g.name",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

/// Каталог персонажей — публичный.
pub async fn characters(State(state): State<AppState>) -> ApiResult<Json<Vec<Character>>> {
    let rows =
        sqlx::query_as::<_, Character>("SELECT id, name, description FROM characters ORDER BY id")
            .fetch_all(&state.db)
            .await?;
    Ok(Json(rows))
}

/// Каталог активных точек для авторизованной части приложения.
pub async fn points(State(state): State<AppState>) -> ApiResult<Json<Vec<Point>>> {
    let rows = sqlx::query_as::<_, Point>(
        "SELECT id, name, description, logo_url, image_urls, location, kind, is_active
         FROM points
         WHERE is_active = 1
         ORDER BY CASE
             WHEN kind = 'noc' AND name = 'Студенческий совет факультета СМ' THEN 0
             WHEN kind = 'noc' AND name = 'Студенческий совет общежития №11' THEN 1
             ELSE 2
         END, name",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

pub async fn point(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Point>> {
    sqlx::query_as::<_, Point>(
        "SELECT id, name, description, logo_url, image_urls, location, kind, is_active
         FROM points WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .map(Json)
    .ok_or_else(|| ApiError::NotFound("точка не найдена".into()))
}

#[derive(Deserialize)]
pub struct SlotsQuery {
    pub point_id: Option<i64>,
}

/// Слоты с занятостью. `mine` — моя команда записана или уже прошла этот слот.
pub async fn slots(
    State(state): State<AppState>,
    user: AuthUser,
    Query(q): Query<SlotsQuery>,
) -> ApiResult<Json<Vec<SlotView>>> {
    let rows = sqlx::query_as::<_, SlotView>(
        "SELECT s.id, s.point_id, p.name AS point_name, s.starts_at, s.ends_at, s.capacity,
                (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = s.id AND b.status = 'active') AS booked,
                EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.group_id = ?
                       AND b.status IN ('active', 'completed')) AS mine
         FROM slots s JOIN points p ON p.id = s.point_id
         WHERE p.is_active = 1 AND (? IS NULL OR s.point_id = ?)
         ORDER BY s.starts_at, p.name",
    )
    .bind(user.group_id)
    .bind(q.point_id)
    .bind(q.point_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

pub async fn rating(
    State(state): State<AppState>,
    _user: AuthUser,
) -> ApiResult<Json<Vec<RatingRow>>> {
    let rows = sqlx::query_as::<_, RatingRow>(&format!(
        "SELECT g.id, g.name, g.department, c.name AS character_name,
                COALESCE((SELECT SUM(points) FROM score_entries se WHERE se.group_id = g.id), 0) AS total_points,
                1 + COALESCE((SELECT SUM(points) FROM score_entries se WHERE se.group_id = g.id), 0) / {LEVEL_STEP} AS level
         FROM groups g LEFT JOIN characters c ON c.id = g.character_id
         ORDER BY total_points DESC, g.name"
    ))
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

pub async fn group_detail(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let group = sqlx::query_as::<_, RatingRow>(&format!(
        "SELECT g.id, g.name, g.department, c.name AS character_name,
                COALESCE((SELECT SUM(points) FROM score_entries se WHERE se.group_id = g.id), 0) AS total_points,
                1 + COALESCE((SELECT SUM(points) FROM score_entries se WHERE se.group_id = g.id), 0) / {LEVEL_STEP} AS level
         FROM groups g LEFT JOIN characters c ON c.id = g.character_id
         WHERE g.id = ?"
    ))
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound("группа не найдена".into()))?;

    let scores = sqlx::query_as::<_, ScoreView>(
        "SELECT se.id, se.group_id, g.name AS group_name, se.point_id, p.name AS point_name,
                u.display_name AS organizer_name, se.kind, se.points, se.comment, se.created_at
         FROM score_entries se
         JOIN groups g ON g.id = se.group_id
         JOIN points p ON p.id = se.point_id
         LEFT JOIN users u ON u.id = se.organizer_id
         WHERE se.group_id = ? ORDER BY se.created_at DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    let bookings = sqlx::query_as::<_, BookingView>(
        "SELECT b.id, b.slot_id, s.point_id, p.name AS point_name, s.starts_at, s.ends_at, b.location,
                b.status, b.created_at, b.mandatory
         FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN points p ON p.id = s.point_id
         WHERE b.group_id = ? ORDER BY s.starts_at",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    let (stats, spent) = load_stats(&state, id).await?;
    let available = (group.total_points - spent).max(0);

    Ok(Json(json!({
        "group": group,
        "scores": scores,
        "bookings": bookings,
        // прокачка персонажа: значения характеристик и нераспределённые баллы
        "stats": stats,
        "spent": spent,
        "available": available,
        "upgrade_cost": UPGRADE_COST,
    })))
}

/// Характеристики команды. Все ключи присутствуют всегда (ненайденные — нули).
/// Второе значение — сколько баллов на них уже списано.
async fn load_stats(state: &AppState, group_id: i64) -> ApiResult<(Value, i64)> {
    let rows: Vec<(String, i64, i64)> =
        sqlx::query_as("SELECT stat, value, spent FROM group_stats WHERE group_id = ?")
            .bind(group_id)
            .fetch_all(&state.db)
            .await?;

    let mut stats = serde_json::Map::new();
    for key in STAT_KEYS {
        stats.insert(key.to_string(), json!(0));
    }

    let mut spent = 0;
    for (stat, value, cost) in rows {
        // потраченное считаем по всем строкам: набор характеристик мог меняться
        spent += cost;
        if stats.contains_key(&stat) {
            stats.insert(stat, json!(value));
        }
    }

    Ok((Value::Object(stats), spent))
}

#[derive(Deserialize)]
pub struct UpgradeBody {
    pub stat: String,
}

/// Староста тратит баллы команды на одну характеристику.
/// Цена списывается в момент покупки и хранится рядом со значением —
/// поменяется константа, уже потраченное пересчитывать не придётся.
pub async fn upgrade_stat(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<UpgradeBody>,
) -> ApiResult<Json<Value>> {
    user.require(&[ROLE_LEADER])?;
    let group_id = user.group()?;

    if !STAT_KEYS.contains(&body.stat.as_str()) {
        return Err(ApiError::BadRequest("неизвестная характеристика".into()));
    }

    // Проверка баланса и списание — в одной транзакции на единственном пишущем
    // соединении: два запроса подряд не смогут потратить одни и те же баллы.
    let mut tx = state.db_w.begin().await?;

    let total: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(points), 0) FROM score_entries WHERE group_id = ?")
            .bind(group_id)
            .fetch_one(&mut *tx)
            .await?;
    let spent: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(spent), 0) FROM group_stats WHERE group_id = ?")
            .bind(group_id)
            .fetch_one(&mut *tx)
            .await?;

    if total - spent < UPGRADE_COST {
        return Err(ApiError::Conflict("не хватает очков".into()));
    }

    let value: i64 = sqlx::query_scalar(
        "INSERT INTO group_stats (group_id, stat, value, spent, updated_at) VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(group_id, stat) DO UPDATE
            SET value = value + 1, spent = spent + excluded.spent, updated_at = excluded.updated_at
         RETURNING value",
    )
    .bind(group_id)
    .bind(&body.stat)
    .bind(UPGRADE_COST)
    .bind(now_ts())
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(json!({
        "stat": body.stat,
        "value": value,
        "available": total - spent - UPGRADE_COST,
    })))
}

#[derive(Deserialize)]
pub struct PickCharacterBody {
    pub character_id: i64,
}

/// Староста один раз выбирает персонажа команды (поменять может только админ).
pub async fn pick_character(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<PickCharacterBody>,
) -> ApiResult<Json<Value>> {
    user.require(&[ROLE_LEADER])?;
    let group_id = user.group()?;

    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM characters WHERE id = ?")
        .bind(body.character_id)
        .fetch_one(&state.db)
        .await?;
    if exists == 0 {
        return Err(ApiError::NotFound("персонаж не найден".into()));
    }

    let updated =
        sqlx::query("UPDATE groups SET character_id = ? WHERE id = ? AND character_id IS NULL")
            .bind(body.character_id)
            .bind(group_id)
            .execute(&state.db_w)
            .await?
            .rows_affected();

    if updated == 0 {
        return Err(ApiError::Conflict(
            "персонаж уже выбран; поменять его может только админ".into(),
        ));
    }
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::ROLE_LEADER;

    #[tokio::test]
    async fn upgrade_spends_one_earned_point_for_one_stat_level() {
        let path = std::env::temp_dir().join(format!(
            "sm-instruction-upgrade-{}.db",
            uuid::Uuid::new_v4()
        ));
        let path_text = path.to_string_lossy().into_owned();
        let (db, db_w) = crate::db::init(&path_text).await.unwrap();
        let state = AppState {
            db: db.clone(),
            db_w: db_w.clone(),
        };

        let group_id: i64 = sqlx::query_scalar("SELECT id FROM groups ORDER BY id LIMIT 1")
            .fetch_one(&db)
            .await
            .unwrap();
        let point_id: i64 = sqlx::query_scalar("SELECT id FROM points ORDER BY id LIMIT 1")
            .fetch_one(&db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO score_entries
                (group_id, point_id, kind, points, comment, created_at)
             VALUES (?, ?, 'manual', 1, '', ?)",
        )
        .bind(group_id)
        .bind(point_id)
        .bind(crate::models::now_ts())
        .execute(&db_w)
        .await
        .unwrap();

        let user = AuthUser {
            id: 1,
            role: ROLE_LEADER.into(),
            group_id: Some(group_id),
            point_id: None,
        };
        let Json(result) = upgrade_stat(
            State(state.clone()),
            user.clone(),
            Json(UpgradeBody {
                stat: "courage".into(),
            }),
        )
        .await
        .unwrap();

        assert_eq!(result["value"], 1);
        assert_eq!(result["available"], 0);
        let row: (i64, i64) = sqlx::query_as(
            "SELECT value, spent FROM group_stats WHERE group_id = ? AND stat = 'courage'",
        )
        .bind(group_id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(row, (1, 1));

        let second = upgrade_stat(
            State(state),
            user,
            Json(UpgradeBody {
                stat: "will".into(),
            }),
        )
        .await;
        assert!(matches!(second, Err(ApiError::Conflict(_))));

        db.close().await;
        db_w.close().await;
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{path_text}{suffix}"));
        }
    }
}
