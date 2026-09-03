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

    // подзапросами, а не JOIN: у точки НОЦ на бронь приходится две оценки,
    // и JOIN размножил бы строки
    let rows = sqlx::query_as::<_, OrganizerBooking>(
        "SELECT b.id, b.group_id, g.name AS group_name, b.status, s.starts_at, s.ends_at,
                b.created_at,
                (SELECT points FROM score_entries se
                  WHERE se.booking_id = b.id AND se.kind = 'test') AS test_points,
                (SELECT points FROM score_entries se
                  WHERE se.booking_id = b.id AND se.kind = 'task') AS task_points
         FROM bookings b
         JOIN slots s ON s.id = b.slot_id
         JOIN groups g ON g.id = b.group_id
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
    /// баллы за тест — обязательны для точек НОЦ и запрещены для остальных
    pub test_points: Option<i64>,
    /// баллы за прохождение — обязательны для НОЦ и активностей
    pub task_points: Option<i64>,
    pub comment: Option<String>,
}

fn check_range(value: i64, what: &str) -> Result<(), ApiError> {
    if (0..=1000).contains(&value) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "{what}: баллы должны быть в диапазоне 0–1000"
        )))
    }
}

/// Завершить визит команды и начислить баллы по правилам типа точки.
pub async fn complete(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CompleteBody>,
) -> ApiResult<Json<Value>> {
    user.require(&[ROLE_ORGANIZER])?;
    let point_id = user.point()?;

    let kind: String = sqlx::query_scalar("SELECT kind FROM points WHERE id = ?")
        .bind(point_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| ApiError::NotFound("точка не найдена".into()))?;

    // какие оценки положены этому типу точки
    let (need_test, need_task) = match kind.as_str() {
        KIND_NOC => (true, true),
        KIND_ACTIVITY => (false, true),
        _ => (false, false), // обязательная точка — только отметка о посещении
    };

    if need_test != body.test_points.is_some() {
        return Err(ApiError::BadRequest(if need_test {
            "укажите баллы за тест".into()
        } else {
            "у этой точки нет теста".into()
        }));
    }
    if need_task != body.task_points.is_some() {
        return Err(ApiError::BadRequest(if need_task {
            "укажите баллы за прохождение".into()
        } else {
            "за обязательную точку баллы не начисляются".into()
        }));
    }
    if let Some(p) = body.test_points {
        check_range(p, "тест")?;
    }
    if let Some(p) = body.task_points {
        check_range(p, "прохождение")?;
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
        return Err(ApiError::Forbidden(
            "эта бронь относится к другой точке".into(),
        ));
    }
    if status != "active" {
        return Err(ApiError::Conflict(
            "бронь уже завершена или отменена".into(),
        ));
    }

    sqlx::query("UPDATE bookings SET status = 'completed' WHERE id = ?")
        .bind(body.booking_id)
        .execute(&mut *tx)
        .await?;

    let comment = body.comment.unwrap_or_default();
    let now = now_ts();
    let mut total = 0;

    for (entry_kind, points) in [("test", body.test_points), ("task", body.task_points)] {
        let Some(points) = points else { continue };
        sqlx::query(
            "INSERT INTO score_entries
                (group_id, point_id, organizer_id, booking_id, kind, points, comment, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(group_id)
        .bind(point_id)
        .bind(user.id)
        .bind(body.booking_id)
        .bind(entry_kind)
        .bind(points)
        .bind(&comment)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        total += points;
    }

    tx.commit().await?;
    Ok(Json(
        json!({ "ok": true, "group_id": group_id, "points": total }),
    ))
}
