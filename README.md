# SM_instruction

Site for university activity "Survival Instructions". Registration, time table, game mechanics, info.

Сайт мероприятия «Инструкция по выживанию»: регистрация команд, бронирование точек по временным
слотам, баллы и рейтинг. Подробности архитектуры и план — в [docs/PLAN.md](docs/PLAN.md).

## Стек

Rust (axum + SQLx) + SQLite. Фронтенд — статика из `static/`, раздаётся тем же бинарником.

## Запуск

```powershell
Copy-Item .env.example .env  # задать сильный ADMIN_PASSWORD и коды регистрации
cargo run                    # http://localhost:8080
```

При первом запуске создаются: админ (`ADMIN_LOGIN`/`ADMIN_PASSWORD`), 13 групп-заглушек
(СМ1-11 … СМ13-11) и стартовые персонажи. API описан в docs/PLAN.md.

## Проверки

```powershell
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets
```

Карта кода, инварианты и актуальный технический долг находятся в [AGENTS.md](AGENTS.md).

## Боевой сервер

Сайт: https://smsurvival.bmstu.ru. Схема размещения, SSH, обновление, резервные копии
и восстановление описаны в [docs/DEPLOY.md](docs/DEPLOY.md). Секреты хранятся только
в игнорируемой папке `private-deploy/` и на сервере.
