# SM_instruction

Site for university activity "Survival Instructions". Registration, time table, game mechanics, info.

Сайт мероприятия «Инструкция по выживанию»: регистрация команд, бронирование точек по временным
слотам, баллы и рейтинг. Подробности архитектуры и план — в [docs/PLAN.md](docs/PLAN.md).

## Стек

Rust (axum + SQLx) + SQLite. Фронтенд — статика из `static/`, раздаётся тем же бинарником.

## Запуск

```sh
cp .env.example .env   # настроить ADMIN_PASSWORD и коды регистрации
cargo run              # http://localhost:8080
```

При первом запуске создаются: админ (`ADMIN_LOGIN`/`ADMIN_PASSWORD`), 13 групп-заглушек
(СМ1-11 … СМ13-11) и стартовые персонажи. API описан в docs/PLAN.md.
