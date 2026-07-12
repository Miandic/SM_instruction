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
    let rows = sqlx::query_as::<_, Character>(
        "SELECT id, name, description FROM characters ORDER BY id",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

/// Публичный: нужен форме регистрации организатора.
pub async fn points(State(state): State<AppState>) -> ApiResult<Json<Vec<Point>>> {
    let rows = sqlx::query_as::<_, Point>(
        "SELECT id, name, description, location, is_active FROM points WHERE is_active = 1 ORDER BY name",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

pub async fn point(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<Point>> {
    sqlx::query_as::<_, Point>(
        "SELECT id, name, description, location, is_active FROM points WHERE id = ?",
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

pub async fn rating(State(state): State<AppState>, _user: AuthUser) -> ApiResult<Json<Vec<RatingRow>>> {
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
                u.display_name AS organizer_name, se.points, se.comment, se.created_at
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
        "SELECT b.id, b.slot_id, s.point_id, p.name AS point_name, s.starts_at, s.ends_at,
                b.status, b.created_at
         FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN points p ON p.id = s.point_id
         WHERE b.group_id = ? ORDER BY s.starts_at",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "group": group, "scores": scores, "bookings": bookings })))
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

    let updated = sqlx::query(
        "UPDATE groups SET character_id = ? WHERE id = ? AND character_id IS NULL",
    )
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
