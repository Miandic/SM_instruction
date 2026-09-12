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
/// Прокачка равномерная: +1 к любой характеристике стоит 1 заработанный балл.
pub const UPGRADE_COST: i64 = 1;

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
    pub total_points: f64,
    pub level: i64,
}

/// Сводка прокачки для администратора. Значения характеристик всегда
/// присутствуют, а `updated_at` отражает последнее изменение баллов или статов.
#[derive(Serialize, FromRow)]
pub struct AdminProgressRow {
    pub group_name: String,
    pub character_name: Option<String>,
    pub total_points: f64,
    pub available_points: f64,
    pub courage: i64,
    pub will: i64,
    pub labor: i64,
    pub persistence: i64,
    pub updated_at: i64,
}

#[derive(Serialize, FromRow)]
pub struct BookingView {
    pub id: i64,
    pub slot_id: i64,
    pub point_id: i64,
    pub point_name: String,
    pub starts_at: i64,
    pub ends_at: i64,
    /// аудитория, назначенная именно этой группе
    pub location: String,
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
    pub points: f64,
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
    pub location: String,
    pub created_at: i64,
    /// Исторические баллы за тест, выставленные до перехода НОЦ на одну оценку
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
