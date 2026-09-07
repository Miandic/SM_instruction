use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::extract::{FromRequestParts, State};
use axum::http::{header, request::Parts};
use axum::Json;
use rand_core::OsRng;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::models::now_ts;
use crate::state::AppState;

const SESSION_TTL: i64 = 30 * 24 * 3600;

pub const ROLE_ADMIN: &str = "admin";
pub const ROLE_LEADER: &str = "leader";
pub const ROLE_STUDENT: &str = "student";
pub const ROLE_ORGANIZER: &str = "organizer";

#[derive(FromRow, Clone)]
pub struct AuthUser {
    pub id: i64,
    pub role: String,
    pub group_id: Option<i64>,
    pub point_id: Option<i64>,
}

impl AuthUser {
    pub fn require(&self, roles: &[&str]) -> Result<(), ApiError> {
        if roles.contains(&self.role.as_str()) {
            Ok(())
        } else {
            Err(ApiError::Forbidden("недостаточно прав".into()))
        }
    }

    pub fn group(&self) -> Result<i64, ApiError> {
        self.group_id
            .ok_or_else(|| ApiError::Forbidden("аккаунт не привязан к группе".into()))
    }

    pub fn point(&self) -> Result<i64, ApiError> {
        self.point_id
            .ok_or_else(|| ApiError::Forbidden("аккаунт не привязан к точке".into()))
    }
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let token = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(|| ApiError::Unauthorized("требуется авторизация".into()))?;

        sqlx::query_as::<_, AuthUser>(
            "SELECT u.id, u.role, u.group_id, u.point_id
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token = ? AND s.expires_at > ?",
        )
        .bind(token)
        .bind(now_ts())
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| ApiError::Unauthorized("сессия недействительна".into()))
    }
}

/// Код организатора точки: 8 символов без похожих друг на друга (0/O, 1/I).
pub fn gen_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ровно 32 символа
    let mut buf = [0u8; 8];
    rand_core::RngCore::fill_bytes(&mut OsRng, &mut buf);
    buf.iter()
        .map(|b| ALPHABET[(b & 31) as usize] as char)
        .collect()
}

pub fn hash_password(password: &str) -> Result<String, ApiError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| ApiError::Internal(e.to_string()))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|h| {
            Argon2::default()
                .verify_password(password.as_bytes(), &h)
                .is_ok()
        })
        .unwrap_or(false)
}

fn registration_code_matches(required: Option<&str>, provided: Option<&str>) -> bool {
    required.is_none_or(|required| provided.map(str::trim) == Some(required))
}

async fn create_session(state: &AppState, user_id: i64) -> ApiResult<String> {
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let now = now_ts();
    sqlx::query(
        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .bind(&token)
    .bind(user_id)
    .bind(now)
    .bind(now + SESSION_TTL)
    .execute(&state.db_w)
    .await?;
    Ok(token)
}

async fn me_json(state: &AppState, user_id: i64) -> ApiResult<Value> {
    let user = sqlx::query_as::<_, crate::models::UserView>(
        "SELECT u.id, u.login, u.display_name, u.role, u.group_id, g.name AS group_name,
                u.point_id, p.name AS point_name, u.created_at
         FROM users u
         LEFT JOIN groups g ON g.id = u.group_id
         LEFT JOIN points p ON p.id = u.point_id
         WHERE u.id = ?",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    serde_json::to_value(user).map_err(|e| ApiError::Internal(e.to_string()))
}

#[derive(Deserialize)]
pub struct RegisterBody {
    pub login: String,
    pub password: String,
    pub display_name: String,
    /// leader | student | organizer
    pub role: String,
    /// для старосты/студента: название группы, например "СМ1-11"
    pub group_name: Option<String>,
    /// для организатора — код его точки; для команды — общий код, если задан
    pub code: Option<String>,
}

pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterBody>,
) -> ApiResult<Json<Value>> {
    let login = body.login.trim().to_string();
    let display_name = body.display_name.trim().to_string();
    if login.len() < 3 {
        return Err(ApiError::BadRequest(
            "логин должен быть не короче 3 символов".into(),
        ));
    }
    if body.password.len() < 6 {
        return Err(ApiError::BadRequest(
            "пароль должен быть не короче 6 символов".into(),
        ));
    }
    if display_name.is_empty() {
        return Err(ApiError::BadRequest("укажите имя".into()));
    }

    let (group_id, point_id): (Option<i64>, Option<i64>) = match body.role.as_str() {
        ROLE_LEADER | ROLE_STUDENT => {
            if !registration_code_matches(
                state.cfg.registration_code.as_deref(),
                body.code.as_deref(),
            ) {
                return Err(ApiError::Forbidden("неверный регистрационный код".into()));
            }
            let name = body
                .group_name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| ApiError::BadRequest("укажите группу".into()))?;
            let id: Option<i64> = sqlx::query_scalar("SELECT id FROM groups WHERE name = ?")
                .bind(name)
                .fetch_optional(&state.db)
                .await?;
            let id = id.ok_or_else(|| ApiError::NotFound(format!("группа {name} не найдена")))?;
            (Some(id), None)
        }
        ROLE_ORGANIZER => {
            // Код выдаётся под конкретную точку — он же и определяет доступы.
            let code = body
                .code
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| ApiError::BadRequest("укажите код организатора".into()))?;

            let point_id: Option<i64> =
                sqlx::query_scalar("SELECT id FROM points WHERE organizer_code = ?")
                    .bind(code)
                    .fetch_optional(&state.db)
                    .await?;
            let point_id =
                point_id.ok_or_else(|| ApiError::Forbidden("неверный код организатора".into()))?;

            (None, Some(point_id))
        }
        _ => {
            return Err(ApiError::BadRequest(
                "роль должна быть leader, student или organizer".into(),
            ))
        }
    };

    let password = body.password.clone();
    let hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))??;

    let role = body.role.clone();
    let res = sqlx::query(
        "INSERT INTO users (login, display_name, password_hash, role, group_id, point_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&login)
    .bind(&display_name)
    .bind(&hash)
    .bind(&role)
    .bind(group_id)
    .bind(point_id)
    .bind(now_ts())
    .execute(&state.db_w)
    .await;

    let user_id = match res {
        Ok(r) => r.last_insert_rowid(),
        Err(sqlx::Error::Database(db)) if db.code().as_deref() == Some("2067") => {
            let msg = db.message().to_string();
            return Err(if msg.contains("users.login") {
                ApiError::Conflict("логин уже занят".into())
            } else if msg.contains("users.group_id") {
                ApiError::Conflict("у этой группы уже есть староста".into())
            } else {
                ApiError::Conflict("запись конфликтует с уже существующей".into())
            });
        }
        Err(e) => return Err(e.into()),
    };

    let token = create_session(&state, user_id).await?;
    let user = me_json(&state, user_id).await?;
    Ok(Json(json!({ "token": token, "user": user })))
}

#[derive(Deserialize)]
pub struct LoginBody {
    pub login: String,
    pub password: String,
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> ApiResult<Json<Value>> {
    let row: Option<(i64, String)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE login = ?")
            .bind(body.login.trim())
            .fetch_optional(&state.db)
            .await?;

    let (user_id, stored_hash) =
        row.ok_or_else(|| ApiError::Unauthorized("неверный логин или пароль".into()))?;

    let password = body.password.clone();
    let ok = tokio::task::spawn_blocking(move || verify_password(&password, &stored_hash))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if !ok {
        return Err(ApiError::Unauthorized("неверный логин или пароль".into()));
    }

    let token = create_session(&state, user_id).await?;
    let user = me_json(&state, user_id).await?;
    Ok(Json(json!({ "token": token, "user": user })))
}

pub async fn logout(
    State(state): State<AppState>,
    parts: axum::http::HeaderMap,
) -> ApiResult<Json<Value>> {
    if let Some(token) = parts
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        sqlx::query("DELETE FROM sessions WHERE token = ?")
            .bind(token)
            .execute(&state.db_w)
            .await?;
    }
    Ok(Json(json!({ "ok": true })))
}

pub async fn me(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    Ok(Json(me_json(&state, user.id).await?))
}

#[cfg(test)]
mod tests {
    use super::registration_code_matches;

    #[test]
    fn registration_code_is_checked_and_trimmed_when_required() {
        assert!(registration_code_matches(
            Some("TEAM-2026"),
            Some("TEAM-2026")
        ));
        assert!(registration_code_matches(
            Some("TEAM-2026"),
            Some("  TEAM-2026  ")
        ));
        assert!(!registration_code_matches(Some("TEAM-2026"), None));
        assert!(!registration_code_matches(Some("TEAM-2026"), Some("wrong")));
    }

    #[test]
    fn registration_code_is_optional_when_not_configured() {
        assert!(registration_code_matches(None, None));
        assert!(registration_code_matches(None, Some("anything")));
    }
}
