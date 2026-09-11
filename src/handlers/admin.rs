use axum::extract::{Multipart, Path, Query, State};
use axum::Json;
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};

use crate::auth::{gen_code, hash_password, AuthUser, ROLE_ADMIN};
use crate::error::{ApiError, ApiResult};
use crate::models::*;
use crate::state::AppState;

fn admin_only(user: &AuthUser) -> Result<(), ApiError> {
    user.require(&[ROLE_ADMIN])
}

fn required_text(value: String, field: &str) -> ApiResult<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        Err(ApiError::BadRequest(format!(
            "поле «{field}» не может быть пустым"
        )))
    } else {
        Ok(value)
    }
}

fn validate_department(department: i64) -> ApiResult<()> {
    if (1..=13).contains(&department) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "номер кафедры должен быть от 1 до 13".into(),
        ))
    }
}

const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;

fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && matches!(&bytes[8..12], b"avif" | b"avis")
    {
        Some("avif")
    } else {
        None
    }
}

/// Загружает одно растровое изображение карточки. Имя клиента не используется:
/// случайное имя исключает обход каталогов и перезапись уже загруженных файлов.
pub async fn upload_image(user: AuthUser, mut multipart: Multipart) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let field = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::BadRequest(format!("не удалось прочитать файл: {e}")))?
        .ok_or_else(|| ApiError::BadRequest("файл не передан".into()))?;
    let bytes = field
        .bytes()
        .await
        .map_err(|e| ApiError::BadRequest(format!("не удалось прочитать файл: {e}")))?;
    if bytes.is_empty() {
        return Err(ApiError::BadRequest("выбран пустой файл".into()));
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(ApiError::BadRequest(
            "изображение должно быть не больше 8 МБ".into(),
        ));
    }
    let ext = image_extension(&bytes)
        .ok_or_else(|| ApiError::BadRequest("поддерживаются PNG, JPEG, WebP, GIF и AVIF".into()))?;

    let dir = std::path::Path::new("static/uploads");
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let filename = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    tokio::fs::write(dir.join(&filename), &bytes)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(json!({ "url": format!("/uploads/{filename}") })))
}

// ---------- users ----------

pub async fn users(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<Vec<UserView>>> {
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
    #[serde(default, deserialize_with = "deserialize_nullable_id")]
    pub group_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_nullable_id")]
    pub point_id: Option<Option<i64>>,
}

/// Для PATCH различаем отсутствующее поле (`None`) и явный JSON `null`
/// (`Some(None)`), которым админ снимает привязку пользователя.
fn deserialize_nullable_id<'de, D>(deserializer: D) -> Result<Option<Option<i64>>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<i64>::deserialize(deserializer).map(Some)
}

pub async fn patch_user(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(body): Json<PatchUserBody>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let mut tx = state.db_w.begin().await?;

    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE id = ?")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if exists == 0 {
        return Err(ApiError::NotFound("пользователь не найден".into()));
    }

    if let Some(name) = body.display_name {
        let name = required_text(name, "имя")?;
        sqlx::query("UPDATE users SET display_name = ? WHERE id = ?")
            .bind(name)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(password) = body.password {
        if password.len() < 6 {
            return Err(ApiError::BadRequest(
                "пароль должен быть не короче 6 символов".into(),
            ));
        }
        let hash = tokio::task::spawn_blocking(move || hash_password(&password))
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))??;
        sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
            .bind(hash)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(role) = body.role {
        if !["admin", "leader", "student", "organizer"].contains(&role.as_str()) {
            return Err(ApiError::BadRequest("недопустимая роль".into()));
        }
        if id == user.id && role != ROLE_ADMIN {
            return Err(ApiError::BadRequest(
                "нельзя снять роль администратора с текущего аккаунта".into(),
            ));
        }
        sqlx::query("UPDATE users SET role = ? WHERE id = ?")
            .bind(role)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(group_id) = body.group_id {
        sqlx::query("UPDATE users SET group_id = ? WHERE id = ?")
            .bind(group_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(point_id) = body.point_id {
        sqlx::query("UPDATE users SET point_id = ? WHERE id = ?")
            .bind(point_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
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
    let name = required_text(body.name, "название группы")?;
    validate_department(body.department)?;
    let id = sqlx::query("INSERT INTO groups (name, department, created_at) VALUES (?, ?, ?)")
        .bind(name)
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

    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM groups WHERE id = ?")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if exists == 0 {
        return Err(ApiError::NotFound("группа не найдена".into()));
    }

    if let Some(name) = body.name {
        let name = required_text(name, "название группы")?;
        sqlx::query("UPDATE groups SET name = ? WHERE id = ?")
            .bind(name)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(dep) = body.department {
        validate_department(dep)?;
        sqlx::query("UPDATE groups SET department = ? WHERE id = ?")
            .bind(dep)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(character_id) = body.character_id {
        sqlx::query("UPDATE groups SET character_id = ? WHERE id = ?")
            .bind(character_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
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
    pub logo_url: Option<String>,
    pub image_urls: Option<String>,
    pub location: Option<String>,
    /// noc | activity | mandatory, по умолчанию noc
    pub kind: Option<String>,
}

/// Список для админа — с кодами организаторов (публичный `/api/points` их не отдаёт).
pub async fn all_points(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<Vec<AdminPoint>>> {
    admin_only(&user)?;
    let rows = sqlx::query_as::<_, AdminPoint>(
        "SELECT id, name, description, logo_url, image_urls, location, kind, is_active, organizer_code
         FROM points ORDER BY kind, name",
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
    let name = required_text(body.name, "название точки")?;
    let kind = body.kind.unwrap_or_else(|| KIND_NOC.to_string());
    if !is_valid_kind(&kind) {
        return Err(ApiError::BadRequest("недопустимый тип точки".into()));
    }
    let code = gen_code();
    let id = sqlx::query(
        "INSERT INTO points
         (name, description, logo_url, image_urls, location, kind, organizer_code)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(name)
    .bind(body.description.unwrap_or_default())
    .bind(body.logo_url.unwrap_or_default())
    .bind(body.image_urls.unwrap_or_default())
    .bind(body.location.unwrap_or_default())
    .bind(&kind)
    .bind(&code)
    .execute(&state.db_w)
    .await?
    .last_insert_rowid();
    Ok(Json(json!({ "id": id, "organizer_code": code })))
}

/// Перегенерировать код точки — если старый утёк.
/// Уже зарегистрированные организаторы своей привязки не теряют.
pub async fn regenerate_code(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    admin_only(&user)?;
    let code = gen_code();
    let updated = sqlx::query("UPDATE points SET organizer_code = ? WHERE id = ?")
        .bind(&code)
        .bind(id)
        .execute(&state.db_w)
        .await?
        .rows_affected();
    if updated == 0 {
        return Err(ApiError::NotFound("точка не найдена".into()));
    }
    Ok(Json(json!({ "organizer_code": code })))
}

#[derive(Deserialize)]
pub struct PatchPointBody {
    pub name: Option<String>,
    pub description: Option<String>,
    pub logo_url: Option<String>,
    pub image_urls: Option<String>,
    pub location: Option<String>,
    pub kind: Option<String>,
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

    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM points WHERE id = ?")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if exists == 0 {
        return Err(ApiError::NotFound("точка не найдена".into()));
    }

    if let Some(name) = body.name {
        let name = required_text(name, "название точки")?;
        sqlx::query("UPDATE points SET name = ? WHERE id = ?")
            .bind(name)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(description) = body.description {
        sqlx::query("UPDATE points SET description = ? WHERE id = ?")
            .bind(description)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(logo_url) = body.logo_url {
        sqlx::query("UPDATE points SET logo_url = ? WHERE id = ?")
            .bind(logo_url.trim())
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(image_urls) = body.image_urls {
        sqlx::query("UPDATE points SET image_urls = ? WHERE id = ?")
            .bind(image_urls.trim())
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(location) = body.location {
        sqlx::query("UPDATE points SET location = ? WHERE id = ?")
            .bind(location)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(kind) = body.kind {
        if !is_valid_kind(&kind) {
            return Err(ApiError::BadRequest("недопустимый тип точки".into()));
        }
        sqlx::query("UPDATE points SET kind = ? WHERE id = ?")
            .bind(kind)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(is_active) = body.is_active {
        sqlx::query("UPDATE points SET is_active = ? WHERE id = ?")
            .bind(is_active)
            .bind(id)
            .execute(&mut *tx)
            .await?;
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
    let break_minutes = body.break_minutes.unwrap_or(0);
    let capacity = body.capacity.unwrap_or(1);
    if body.slot_minutes <= 0
        || break_minutes < 0
        || capacity <= 0
        || !(1..=200).contains(&body.count)
    {
        return Err(ApiError::BadRequest(
            "некорректные параметры генерации".into(),
        ));
    }
    let start = chrono::DateTime::parse_from_rfc3339(&body.first_start)
        .map_err(|e| ApiError::BadRequest(format!("first_start: неверный формат даты ({e})")))?
        .timestamp();
    let slot_seconds = body
        .slot_minutes
        .checked_mul(60)
        .ok_or_else(|| ApiError::BadRequest("слишком большая длительность слота".into()))?;
    let step = body
        .slot_minutes
        .checked_add(break_minutes)
        .and_then(|minutes| minutes.checked_mul(60))
        .ok_or_else(|| ApiError::BadRequest("слишком большой интервал слотов".into()))?;

    let mut tx = state.db_w.begin().await?;
    let mut ids = Vec::new();
    for i in 0..body.count {
        let s = i
            .checked_mul(step)
            .and_then(|offset| start.checked_add(offset))
            .ok_or_else(|| {
                ApiError::BadRequest("дата слота выходит за допустимый диапазон".into())
            })?;
        let ends_at = s.checked_add(slot_seconds).ok_or_else(|| {
            ApiError::BadRequest("дата слота выходит за допустимый диапазон".into())
        })?;
        let id = sqlx::query(
            "INSERT INTO slots (point_id, starts_at, ends_at, capacity) VALUES (?, ?, ?, ?)",
        )
        .bind(body.point_id)
        .bind(s)
        .bind(ends_at)
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
    let active: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE slot_id = ? AND status = 'active'")
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
        /// назначенная админом бронь на обязательную точку
        mandatory: bool,
    }
    let rows = sqlx::query_as::<_, AdminBooking>(
        "SELECT b.id, b.group_id, g.name AS group_name, p.name AS point_name,
                s.starts_at, s.ends_at, b.status, b.created_at, b.mandatory
         FROM bookings b
         JOIN slots s ON s.id = b.slot_id
         JOIN groups g ON g.id = b.group_id
         JOIN points p ON p.id = s.point_id
         ORDER BY s.starts_at",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        serde_json::to_value(rows).map_err(|e| ApiError::Internal(e.to_string()))?,
    ))
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
        "SELECT s.id, s.point_id, s.starts_at, s.ends_at, s.capacity, p.kind
         FROM slots s JOIN points p ON p.id = s.point_id WHERE s.id = ?",
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

    let mandatory = slot.kind == KIND_MANDATORY;

    // Обычная бронь вытесняет предыдущую — админ знает, что делает.
    // Обязательная идёт параллельно и текущую бронь команды не трогает.
    if !mandatory {
        sqlx::query(
            "UPDATE bookings SET status = 'cancelled'
             WHERE group_id = ? AND status = 'active' AND mandatory = 0",
        )
        .bind(body.group_id)
        .execute(&mut *tx)
        .await?;
    }

    let id = sqlx::query(
        "INSERT INTO bookings (slot_id, group_id, status, mandatory, created_at, created_by)
         VALUES (?, ?, 'active', ?, ?, ?)",
    )
    .bind(slot.id)
    .bind(body.group_id)
    .bind(mandatory)
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
                u.display_name AS organizer_name, se.kind, se.points, se.comment, se.created_at
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
        "INSERT INTO score_entries
            (group_id, point_id, organizer_id, kind, points, comment, created_at)
         VALUES (?, ?, ?, 'manual', ?, ?, ?)",
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
    let name = required_text(body.name, "имя персонажа")?;
    let id = sqlx::query("INSERT INTO characters (name, description) VALUES (?, ?)")
        .bind(name)
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

#[cfg(test)]
mod tests {
    use super::{image_extension, PatchUserBody};

    #[test]
    fn detects_supported_image_signatures() {
        assert_eq!(image_extension(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(image_extension(b"\xff\xd8\xffrest"), Some("jpg"));
        assert_eq!(image_extension(b"GIF89arest"), Some("gif"));
        assert_eq!(image_extension(b"RIFF1234WEBPrest"), Some("webp"));
        assert_eq!(image_extension(b"1234ftypavifrest"), Some("avif"));
    }

    #[test]
    fn rejects_non_images_and_svg() {
        assert_eq!(image_extension(b"plain text"), None);
        assert_eq!(image_extension(b"<svg><script/></svg>"), None);
    }

    #[test]
    fn patch_user_distinguishes_missing_and_null_relations() {
        let missing: PatchUserBody = serde_json::from_str("{}").unwrap();
        assert_eq!(missing.group_id, None);
        assert_eq!(missing.point_id, None);

        let cleared: PatchUserBody =
            serde_json::from_str(r#"{"group_id":null,"point_id":null}"#).unwrap();
        assert_eq!(cleared.group_id, Some(None));
        assert_eq!(cleared.point_id, Some(None));

        let assigned: PatchUserBody =
            serde_json::from_str(r#"{"group_id":7,"point_id":9}"#).unwrap();
        assert_eq!(assigned.group_id, Some(Some(7)));
        assert_eq!(assigned.point_id, Some(Some(9)));
    }
}
