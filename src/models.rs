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

#[derive(Serialize, FromRow)]
pub struct Point {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub location: String,
    pub is_active: bool,
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
}

#[derive(Serialize, FromRow)]
pub struct ScoreView {
    pub id: i64,
    pub group_id: i64,
    pub group_name: String,
    pub point_id: i64,
    pub point_name: String,
    pub organizer_name: Option<String>,
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
    /// начисленные баллы, если визит завершён
    pub points: Option<i64>,
}

#[derive(FromRow)]
pub struct Slot {
    pub id: i64,
    pub point_id: i64,
    pub starts_at: i64,
    pub ends_at: i64,
    pub capacity: i64,
}
