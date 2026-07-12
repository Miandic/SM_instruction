use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{AuthUser, ROLE_LEADER};
use crate::error::{ApiError, ApiResult};
use crate::models::*;
use crate::state::AppState;

/// За сколько секунд до начала слота открывается бронирование.
pub const BOOKING_WINDOW: i64 = 15 * 60;

#[derive(Deserialize)]
pub struct CreateBookingBody {
    pub slot_id: i64,
}

pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateBookingBody>,
) -> ApiResult<Json<BookingView>> {
    user.require(&[ROLE_LEADER])?;
    let group_id = user.group()?;

    let slot = sqlx::query_as::<_, Slot>(
        "SELECT s.id, s.point_id, s.starts_at, s.ends_at, s.capacity
         FROM slots s JOIN points p ON p.id = s.point_id
         WHERE s.id = ? AND p.is_active = 1",
    )
    .bind(body.slot_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound("слот не найден".into()))?;

    let now = now_ts();
    if now < slot.starts_at - BOOKING_WINDOW {
        return Err(ApiError::BadRequest(
            "занять слот можно не раньше чем за 15 минут до его начала".into(),
        ));
    }
    if now >= slot.ends_at {
        return Err(ApiError::BadRequest("слот уже завершился".into()));
    }

    // Все проверки и вставка — в одной транзакции на единственном пишущем
    // соединении, поэтому две команды не смогут занять последнее место одновременно.
    let mut tx = state.db_w.begin().await?;

    let booked: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE slot_id = ? AND status = 'active'")
            .bind(slot.id)
            .fetch_one(&mut *tx)
            .await?;
    if booked >= slot.capacity {
        return Err(ApiError::Conflict("слот уже занят".into()));
    }

    let has_active: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE group_id = ? AND status = 'active'")
            .bind(group_id)
            .fetch_one(&mut *tx)
            .await?;
    if has_active > 0 {
        return Err(ApiError::Conflict(
            "у команды уже есть активная бронь — сначала завершите или отмените её".into(),
        ));
    }

    let visited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookings b JOIN slots s ON s.id = b.slot_id
         WHERE b.group_id = ? AND s.point_id = ? AND b.status IN ('active', 'completed')",
    )
    .bind(group_id)
    .bind(slot.point_id)
    .fetch_one(&mut *tx)
    .await?;
    if visited > 0 {
        return Err(ApiError::Conflict("команда уже проходила эту точку".into()));
    }

    let booking_id = sqlx::query(
        "INSERT INTO bookings (slot_id, group_id, status, created_at, created_by)
         VALUES (?, ?, 'active', ?, ?)",
    )
    .bind(slot.id)
    .bind(group_id)
    .bind(now)
    .bind(user.id)
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();

    tx.commit().await?;

    let view = fetch_booking(&state, booking_id).await?;
    Ok(Json(view))
}

pub async fn cancel(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    user.require(&[ROLE_LEADER])?;
    let group_id = user.group()?;

    let updated = sqlx::query(
        "UPDATE bookings SET status = 'cancelled'
         WHERE id = ? AND group_id = ? AND status = 'active'",
    )
    .bind(id)
    .bind(group_id)
    .execute(&state.db_w)
    .await?
    .rows_affected();

    if updated == 0 {
        return Err(ApiError::NotFound(
            "активная бронь вашей команды с таким id не найдена".into(),
        ));
    }
    Ok(Json(json!({ "ok": true })))
}

/// Все брони команды пользователя (история + активная).
pub async fn my(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Vec<BookingView>>> {
    let group_id = user.group()?;
    let rows = sqlx::query_as::<_, BookingView>(
        "SELECT b.id, b.slot_id, s.point_id, p.name AS point_name, s.starts_at, s.ends_at,
                b.status, b.created_at
         FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN points p ON p.id = s.point_id
         WHERE b.group_id = ? ORDER BY s.starts_at",
    )
    .bind(group_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

pub async fn fetch_booking(state: &AppState, id: i64) -> ApiResult<BookingView> {
    sqlx::query_as::<_, BookingView>(
        "SELECT b.id, b.slot_id, s.point_id, p.name AS point_name, s.starts_at, s.ends_at,
                b.status, b.created_at
         FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN points p ON p.id = s.point_id
         WHERE b.id = ?",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound("бронь не найдена".into()))
}
