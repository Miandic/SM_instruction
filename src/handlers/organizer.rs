use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{AuthUser, ROLE_ORGANIZER};
use crate::error::{ApiError, ApiResult};
use crate::models::*;
use crate::state::AppState;

/// Записи (активные и завершённые) на точку организатора.
pub async fn bookings(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<Vec<OrganizerBooking>>> {
    user.require(&[ROLE_ORGANIZER])?;
    let point_id = user.point()?;

    let rows = sqlx::query_as::<_, OrganizerBooking>(
        "SELECT b.id, b.group_id, g.name AS group_name, b.status, s.starts_at, s.ends_at,
                b.created_at, se.points
         FROM bookings b
         JOIN slots s ON s.id = b.slot_id
         JOIN groups g ON g.id = b.group_id
         LEFT JOIN score_entries se ON se.booking_id = b.id
         WHERE s.point_id = ? AND b.status IN ('active', 'completed')
         ORDER BY s.starts_at",
    )
    .bind(point_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct CompleteBody {
    pub booking_id: i64,
    pub points: i64,
    pub comment: Option<String>,
}

/// Завершить визит команды и начислить баллы.
pub async fn complete(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CompleteBody>,
) -> ApiResult<Json<Value>> {
    user.require(&[ROLE_ORGANIZER])?;
    let point_id = user.point()?;

    if !(0..=1000).contains(&body.points) {
        return Err(ApiError::BadRequest("баллы должны быть в диапазоне 0–1000".into()));
    }

    let mut tx = state.db_w.begin().await?;

    let row: Option<(i64, String, i64)> = sqlx::query_as(
        "SELECT b.group_id, b.status, s.point_id
         FROM bookings b JOIN slots s ON s.id = b.slot_id WHERE b.id = ?",
    )
    .bind(body.booking_id)
    .fetch_optional(&mut *tx)
    .await?;

    let (group_id, status, booking_point) =
        row.ok_or_else(|| ApiError::NotFound("бронь не найдена".into()))?;
    if booking_point != point_id {
        return Err(ApiError::Forbidden("эта бронь относится к другой точке".into()));
    }
    if status != "active" {
        return Err(ApiError::Conflict("бронь уже завершена или отменена".into()));
    }

    sqlx::query("UPDATE bookings SET status = 'completed' WHERE id = ?")
        .bind(body.booking_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query(
        "INSERT INTO score_entries (group_id, point_id, organizer_id, booking_id, points, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(group_id)
    .bind(point_id)
    .bind(user.id)
    .bind(body.booking_id)
    .bind(body.points)
    .bind(body.comment.unwrap_or_default())
    .bind(now_ts())
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "ok": true, "group_id": group_id, "points": body.points })))
}
