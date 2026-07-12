use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{hash_password, AuthUser, ROLE_ADMIN};
use crate::error::{ApiError, ApiResult};
use crate::models::*;
use crate::state::AppState;

fn admin_only(user: &AuthUser) -> Result<(), ApiError> {
    user.require(&[ROLE_ADMIN])
}

// ---------- users ----------

pub async fn users(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Vec<UserView>>> {
    admin_only(&user)?;
    let rows = sqlx::query_as::<_, UserView>(
        "SELECT u.id, u.login, u.display_name, u.role, u.group_id, g.name AS group_name,
                u.point_id, p.name AS point_name, u.created_at
         FROM users u
         LEFT JOIN groups g ON g.id = u.group_id
         LEFT JOIN points p ON p.id = u.point_id
         ORDER BY u.role, u.login",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct PatchUserBody {
    pub display_name: Option<String>,
    pub password: Option<String>,
    pub role: Option<String>,
    pub group_id: Option<Option<i64>>,
    pub point_id: Option<Option<i64>>,
}

pub async fn patch_user(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(body): Json<PatchUserBody>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let mut tx = state.db_w.begin().await?;

    if let Some(name) = body.display_name {
        sqlx::query("UPDATE users SET display_name = ? WHERE id = ?")
            .bind(name).bind(id).execute(&mut *tx).await?;
    }
    if let Some(password) = body.password {
        let hash = tokio::task::spawn_blocking(move || hash_password(&password))
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))??;
        sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
            .bind(hash).bind(id).execute(&mut *tx).await?;
    }
    if let Some(role) = body.role {
        if !["admin", "leader", "student", "organizer"].contains(&role.as_str()) {
            return Err(ApiError::BadRequest("недопустимая роль".into()));
        }
        sqlx::query("UPDATE users SET role = ? WHERE id = ?")
            .bind(role).bind(id).execute(&mut *tx).await?;
    }
    if let Some(group_id) = body.group_id {
        sqlx::query("UPDATE users SET group_id = ? WHERE id = ?")
            .bind(group_id).bind(id).execute(&mut *tx).await?;
    }
    if let Some(point_id) = body.point_id {
        sqlx::query("UPDATE users SET point_id = ? WHERE id = ?")
            .bind(point_id).bind(id).execute(&mut *tx).await?;
    }

    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete_user(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    if id == user.id {
        return Err(ApiError::BadRequest("нельзя удалить самого себя".into()));
    }
    let deleted = sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(id)
        .execute(&state.db_w)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(ApiError::NotFound("пользователь не найден".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

// ---------- groups ----------

#[derive(Deserialize)]
pub struct CreateGroupBody {
    pub name: String,
    pub department: i64,
}

pub async fn create_group(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateGroupBody>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let id = sqlx::query("INSERT INTO groups (name, department, created_at) VALUES (?, ?, ?)")
        .bind(body.name.trim())
        .bind(body.department)
        .bind(now_ts())
        .execute(&state.db_w)
        .await?
        .last_insert_rowid();
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
pub struct PatchGroupBody {
    pub name: Option<String>,
    pub department: Option<i64>,
    pub character_id: Option<Option<i64>>,
}

pub async fn patch_group(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(body): Json<PatchGroupBody>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let mut tx = state.db_w.begin().await?;
    if let Some(name) = body.name {
        sqlx::query("UPDATE groups SET name = ? WHERE id = ?")
            .bind(name.trim().to_string()).bind(id).execute(&mut *tx).await?;
    }
    if let Some(dep) = body.department {
        sqlx::query("UPDATE groups SET department = ? WHERE id = ?")
            .bind(dep).bind(id).execute(&mut *tx).await?;
    }
    if let Some(character_id) = body.character_id {
        sqlx::query("UPDATE groups SET character_id = ? WHERE id = ?")
            .bind(character_id).bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete_group(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let deleted = sqlx::query("DELETE FROM groups WHERE id = ?")
        .bind(id)
        .execute(&state.db_w)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(ApiError::NotFound("группа не найдена".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

// ---------- points ----------

#[derive(Deserialize)]
pub struct CreatePointBody {
    pub name: String,
    pub description: Option<String>,
    pub location: Option<String>,
}

pub async fn all_points(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Vec<Point>>> {
    admin_only(&user)?;
    let rows = sqlx::query_as::<_, Point>(
        "SELECT id, name, description, location, is_active FROM points ORDER BY name",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

pub async fn create_point(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreatePointBody>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let id = sqlx::query("INSERT INTO points (name, description, location) VALUES (?, ?, ?)")
        .bind(body.name.trim())
        .bind(body.description.unwrap_or_default())
        .bind(body.location.unwrap_or_default())
        .execute(&state.db_w)
        .await?
        .last_insert_rowid();
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
pub struct PatchPointBody {
    pub name: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub is_active: Option<bool>,
}

pub async fn patch_point(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(body): Json<PatchPointBody>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let mut tx = state.db_w.begin().await?;
    if let Some(name) = body.name {
        sqlx::query("UPDATE points SET name = ? WHERE id = ?")
            .bind(name).bind(id).execute(&mut *tx).await?;
    }
    if let Some(description) = body.description {
        sqlx::query("UPDATE points SET description = ? WHERE id = ?")
            .bind(description).bind(id).execute(&mut *tx).await?;
    }
    if let Some(location) = body.location {
        sqlx::query("UPDATE points SET location = ? WHERE id = ?")
            .bind(location).bind(id).execute(&mut *tx).await?;
    }
    if let Some(is_active) = body.is_active {
        sqlx::query("UPDATE points SET is_active = ? WHERE id = ?")
            .bind(is_active).bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete_point(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let deleted = sqlx::query("DELETE FROM points WHERE id = ?")
        .bind(id)
        .execute(&state.db_w)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(ApiError::NotFound("точка не найдена".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

// ---------- slots ----------

#[derive(Deserialize)]
pub struct GenerateSlotsBody {
    pub point_id: i64,
    /// начало первого слота, RFC 3339, например "2026-09-25T10:00:00+03:00"
    pub first_start: String,
    pub slot_minutes: i64,
    pub count: i64,
    /// перерыв между слотами в минутах (по умолчанию 0)
    pub break_minutes: Option<i64>,
    pub capacity: Option<i64>,
}

pub async fn generate_slots(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<GenerateSlotsBody>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    if body.slot_minutes <= 0 || !(1..=200).contains(&body.count) {
        return Err(ApiError::BadRequest("некорректные параметры генерации".into()));
    }
    let start = chrono::DateTime::parse_from_rfc3339(&body.first_start)
        .map_err(|e| ApiError::BadRequest(format!("first_start: неверный формат даты ({e})")))?
        .timestamp();
    let step = (body.slot_minutes + body.break_minutes.unwrap_or(0)) * 60;
    let capacity = body.capacity.unwrap_or(1).max(1);

    let mut tx = state.db_w.begin().await?;
    let mut ids = Vec::new();
    for i in 0..body.count {
        let s = start + i * step;
        let id = sqlx::query(
            "INSERT INTO slots (point_id, starts_at, ends_at, capacity) VALUES (?, ?, ?, ?)",
        )
        .bind(body.point_id)
        .bind(s)
        .bind(s + body.slot_minutes * 60)
        .bind(capacity)
        .execute(&mut *tx)
        .await?
        .last_insert_rowid();
        ids.push(id);
    }
    tx.commit().await?;
    Ok(Json(json!({ "created": ids })))
}

pub async fn delete_slot(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let active: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookings WHERE slot_id = ? AND status = 'active'",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    if active > 0 {
        return Err(ApiError::Conflict(
            "на слот есть активная бронь — сначала отмените её".into(),
        ));
    }
    let deleted = sqlx::query("DELETE FROM slots WHERE id = ?")
        .bind(id)
        .execute(&state.db_w)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(ApiError::NotFound("слот не найден".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

// ---------- bookings ----------

pub async fn bookings(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    #[derive(serde::Serialize, sqlx::FromRow)]
    struct AdminBooking {
        id: i64,
        group_id: i64,
        group_name: String,
        point_name: String,
        starts_at: i64,
        ends_at: i64,
        status: String,
        created_at: i64,
    }
    let rows = sqlx::query_as::<_, AdminBooking>(
        "SELECT b.id, b.group_id, g.name AS group_name, p.name AS point_name,
                s.starts_at, s.ends_at, b.status, b.created_at
         FROM bookings b
         JOIN slots s ON s.id = b.slot_id
         JOIN groups g ON g.id = b.group_id
         JOIN points p ON p.id = s.point_id
         ORDER BY s.starts_at",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(serde_json::to_value(rows).map_err(|e| ApiError::Internal(e.to_string()))?))
}

#[derive(Deserialize)]
pub struct AdminCreateBookingBody {
    pub slot_id: i64,
    pub group_id: i64,
}

/// Создание брони админом — в обход временного окна и лимита «одна бронь»,
/// но не в обход вместимости слота.
pub async fn create_booking(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<AdminCreateBookingBody>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let mut tx = state.db_w.begin().await?;

    let slot: Option<Slot> = sqlx::query_as(
        "SELECT id, point_id, starts_at, ends_at, capacity FROM slots WHERE id = ?",
    )
    .bind(body.slot_id)
    .fetch_optional(&mut *tx)
    .await?;
    let slot = slot.ok_or_else(|| ApiError::NotFound("слот не найден".into()))?;

    let booked: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE slot_id = ? AND status = 'active'")
            .bind(slot.id)
            .fetch_one(&mut *tx)
            .await?;
    if booked >= slot.capacity {
        return Err(ApiError::Conflict("слот уже занят".into()));
    }

    // активную бронь группы, если есть, отменяем — админ знает, что делает
    sqlx::query("UPDATE bookings SET status = 'cancelled' WHERE group_id = ? AND status = 'active'")
        .bind(body.group_id)
        .execute(&mut *tx)
        .await?;

    let id = sqlx::query(
        "INSERT INTO bookings (slot_id, group_id, status, created_at, created_by)
         VALUES (?, ?, 'active', ?, ?)",
    )
    .bind(slot.id)
    .bind(body.group_id)
    .bind(now_ts())
    .bind(user.id)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    tx.commit().await?;
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
pub struct PatchBookingBody {
    /// active | completed | cancelled
    pub status: String,
}

pub async fn patch_booking(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(body): Json<PatchBookingBody>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    if !["active", "completed", "cancelled"].contains(&body.status.as_str()) {
        return Err(ApiError::BadRequest("недопустимый статус".into()));
    }
    let updated = sqlx::query("UPDATE bookings SET status = ? WHERE id = ?")
        .bind(&body.status)
        .bind(id)
        .execute(&state.db_w)
        .await?
        .rows_affected();
    if updated == 0 {
        return Err(ApiError::NotFound("бронь не найдена".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

// ---------- scores ----------

#[derive(Deserialize)]
pub struct ScoresQuery {
    pub group_id: Option<i64>,
}

pub async fn scores(
    State(state): State<AppState>,
    user: AuthUser,
    Query(q): Query<ScoresQuery>,
) -> ApiResult<Json<Vec<ScoreView>>> {
    admin_only(&user)?;
    let rows = sqlx::query_as::<_, ScoreView>(
        "SELECT se.id, se.group_id, g.name AS group_name, se.point_id, p.name AS point_name,
                u.display_name AS organizer_name, se.points, se.comment, se.created_at
         FROM score_entries se
         JOIN groups g ON g.id = se.group_id
         JOIN points p ON p.id = se.point_id
         LEFT JOIN users u ON u.id = se.organizer_id
         WHERE (? IS NULL OR se.group_id = ?)
         ORDER BY se.created_at DESC",
    )
    .bind(q.group_id)
    .bind(q.group_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct CreateScoreBody {
    pub group_id: i64,
    pub point_id: i64,
    pub points: i64,
    pub comment: Option<String>,
}

pub async fn create_score(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateScoreBody>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let id = sqlx::query(
        "INSERT INTO score_entries (group_id, point_id, organizer_id, points, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(body.group_id)
    .bind(body.point_id)
    .bind(user.id)
    .bind(body.points)
    .bind(body.comment.unwrap_or_default())
    .bind(now_ts())
    .execute(&state.db_w)
    .await?
    .last_insert_rowid();
    Ok(Json(json!({ "id": id })))
}

pub async fn delete_score(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let deleted = sqlx::query("DELETE FROM score_entries WHERE id = ?")
        .bind(id)
        .execute(&state.db_w)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(ApiError::NotFound("начисление не найдено".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

// ---------- characters ----------

#[derive(Deserialize)]
pub struct CreateCharacterBody {
    pub name: String,
    pub description: Option<String>,
}

pub async fn create_character(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateCharacterBody>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let id = sqlx::query("INSERT INTO characters (name, description) VALUES (?, ?)")
        .bind(body.name.trim())
        .bind(body.description.unwrap_or_default())
        .execute(&state.db_w)
        .await?
        .last_insert_rowid();
    Ok(Json(json!({ "id": id })))
}

pub async fn delete_character(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let deleted = sqlx::query("DELETE FROM characters WHERE id = ?")
        .bind(id)
        .execute(&state.db_w)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(ApiError::NotFound("персонаж не найден".into()));
    }
    Ok(Json(json!({ "ok": true })))
}
