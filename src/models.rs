use serde::Serialize;
use sqlx::FromRow;

pub fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// Сколько баллов нужно на один уровень персонажа.
pub const LEVEL_STEP: i64 = 100;

/// Характеристики персонажа. Ключи хранятся в group_stats, подписи —
/// на фронте (static/content.js), чтобы переименование не трогало БД.
pub const STAT_KEYS: [&str; 4] = ["courage", "will", "labor", "persistence"];

/// Сколько баллов команды стоит один уровень характеристики.
/// ЗАГЛУШКА: правила прокачки придут от заказчика.
pub const UPGRADE_COST: i64 = 10;

/// Типы точек. Определяют, сколько оценок ставит организатор и кто записывает.
pub const KIND_NOC: &str = "noc";
pub const KIND_ACTIVITY: &str = "activity";
pub const KIND_MANDATORY: &str = "mandatory";

pub fn is_valid_kind(kind: &str) -> bool {
    matches!(kind, KIND_NOC | KIND_ACTIVITY | KIND_MANDATORY)
}

#[derive(Serialize, FromRow)]
pub struct Point {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub logo_url: String,
    pub image_urls: String,
    pub location: String,
    pub kind: String,
    pub is_active: bool,
}

/// То же плюс код организатора — отдаётся только админу.
#[derive(Serialize, FromRow)]
pub struct AdminPoint {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub logo_url: String,
    pub image_urls: String,
    pub location: String,
    pub kind: String,
    pub is_active: bool,
    pub organizer_code: Option<String>,
}

#[derive(Serialize, FromRow)]
pub struct Character {
    pub id: i64,
    pub name: String,
    pub description: String,
}

#[derive(Serialize, FromRow)]
pub struct GroupBrief {
    pub id: i64,
    pub name: String,
    pub department: i64,
    pub has_leader: bool,
}

#[derive(Serialize, FromRow)]
pub struct SlotView {
    pub id: i64,
    pub point_id: i64,
    pub point_name: String,
    pub starts_at: i64,
    pub ends_at: i64,
    pub capacity: i64,
    /// количество активных броней
    pub booked: i64,
    /// моя команда записана (active) или уже прошла (completed) этот слот
    pub mine: bool,
}

#[derive(Serialize, FromRow)]
pub struct RatingRow {
    pub id: i64,
    pub name: String,
    pub department: i64,
    pub character_name: Option<String>,
    pub total_points: i64,
    pub level: i64,
}

#[derive(Serialize, FromRow)]
pub struct BookingView {
    pub id: i64,
    pub slot_id: i64,
    pub point_id: i64,
    pub point_name: String,
    pub starts_at: i64,
    pub ends_at: i64,
    pub status: String,
    pub created_at: i64,
    /// бронь на обязательную точку: назначена админом, команда её не трогает
    /// и лимит «одна активная бронь» она не занимает
    pub mandatory: bool,
}

#[derive(Serialize, FromRow)]
pub struct ScoreView {
    pub id: i64,
    pub group_id: i64,
    pub group_name: String,
    pub point_id: i64,
    pub point_name: String,
    pub organizer_name: Option<String>,
    /// test | task | manual
    pub kind: String,
    pub points: i64,
    pub comment: String,
    pub created_at: i64,
}

#[derive(Serialize, FromRow)]
pub struct UserView {
    pub id: i64,
    pub login: String,
    pub display_name: String,
    pub role: String,
    pub group_id: Option<i64>,
    pub group_name: Option<String>,
    pub point_id: Option<i64>,
    pub point_name: Option<String>,
    pub created_at: i64,
}

#[derive(Serialize, FromRow)]
pub struct OrganizerBooking {
    pub id: i64,
    pub group_id: i64,
    pub group_name: String,
    pub status: String,
    pub starts_at: i64,
    pub ends_at: i64,
    pub created_at: i64,
    /// баллы за тест — только у точек НОЦ
    pub test_points: Option<i64>,
    /// баллы за прохождение точки
    pub task_points: Option<i64>,
}

#[derive(FromRow)]
pub struct Slot {
    pub id: i64,
    pub point_id: i64,
    pub starts_at: i64,
    pub ends_at: i64,
    pub capacity: i64,
    /// тип точки, к которой относится слот
    pub kind: String,
}
