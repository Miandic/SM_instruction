mod auth;
mod db;
mod error;
mod handlers;
mod models;
mod state;

use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::http::{header, HeaderValue};
use axum::routing::{delete, get, patch, post};
use axum::Router;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::handlers::{admin, booking, organizer, public};
use crate::state::{AppState, Config};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=warn".into()),
        )
        .init();

    let db_path = std::env::var("DATABASE_PATH").unwrap_or_else(|_| "data.db".into());
    let (db, db_w) = db::init(&db_path).await.expect("db init failed");

    let state = AppState {
        db,
        db_w,
        cfg: Arc::new(Config {
            registration_code: std::env::var("REGISTRATION_CODE")
                .ok()
                .filter(|s| !s.is_empty()),
        }),
    };

    let api = Router::new()
        // без авторизации
        .route("/health", get(public::health))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/groups", get(public::groups))
        .route("/characters", get(public::characters))
        // любая авторизованная роль
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/points", get(public::points))
        .route("/points/{id}", get(public::point))
        .route("/slots", get(public::slots))
        .route("/rating", get(public::rating))
        .route("/groups/{id}", get(public::group_detail))
        // староста
        .route("/bookings", post(booking::create))
        .route("/bookings/my", get(booking::my))
        .route("/bookings/{id}", delete(booking::cancel))
        .route("/character", post(public::pick_character))
        .route("/character/upgrade", post(public::upgrade_stat))
        // организатор точки
        .route("/organizer/bookings", get(organizer::bookings))
        .route("/organizer/complete", post(organizer::complete))
        // админ
        .route("/admin/users", get(admin::users))
        .route(
            "/admin/users/{id}",
            patch(admin::patch_user).delete(admin::delete_user),
        )
        .route("/admin/groups", post(admin::create_group))
        .route(
            "/admin/groups/{id}",
            patch(admin::patch_group).delete(admin::delete_group),
        )
        .route(
            "/admin/points",
            get(admin::all_points).post(admin::create_point),
        )
        .route(
            "/admin/points/{id}",
            patch(admin::patch_point).delete(admin::delete_point),
        )
        .route("/admin/points/{id}/code", post(admin::regenerate_code))
        .route(
            "/admin/uploads",
            post(admin::upload_image).layer(DefaultBodyLimit::max(9 * 1024 * 1024)),
        )
        .route("/admin/slots", post(admin::generate_slots))
        .route("/admin/slots/{id}", delete(admin::delete_slot))
        .route(
            "/admin/bookings",
            get(admin::bookings).post(admin::create_booking),
        )
        .route("/admin/bookings/{id}", patch(admin::patch_booking))
        .route(
            "/admin/scores",
            get(admin::scores).post(admin::create_score),
        )
        .route("/admin/scores/{id}", delete(admin::delete_score))
        .route("/admin/characters", post(admin::create_character))
        .route("/admin/characters/{id}", delete(admin::delete_character));

    let app = Router::new()
        .nest("/api", api)
        .fallback_service(ServeDir::new("static"))
        // Без этого браузер кеширует статику эвристически (Cache-Control ServeDir
        // не ставит) и после обновления сайта может держать старый JS. `no-cache`
        // — не «не кешировать», а «каждый раз спрашивать»: ServeDir отвечает 304,
        // пока файл не менялся, так что трафика это почти не добавляет.
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // BIND_ADDR имеет приоритет; PORT — для запуска из инструментов с автоподбором порта
    let addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| {
        let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
        format!("0.0.0.0:{port}")
    });
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("bind failed");
    // 0.0.0.0 — адрес для bind, в браузере он не открывается; показываем кликабельный localhost
    let shown = addr.replace("0.0.0.0", "localhost");
    tracing::info!("сервер запущен на http://{shown} (bind: {addr})");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server error");
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutdown requested; waiting for active requests");
}
