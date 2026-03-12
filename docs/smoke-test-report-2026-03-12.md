# Smoke Test Report 2026-03-12

## Scope

Минимальная ручная smoke-проверка backend на стадии после:

- миграции `20260312142242_add_password_action_tokens`
- автосоздания и привязки локального `User` к `Employee`
- добавления `invite/reset-password` flow
- фикса legacy wildcard warning в `AppModule`

## Environment

- дата проверки: `2026-03-12`
- project root: `/Users/gredd/Code/merchslop`
- backend: `NestJS`
- Node.js: `v25.8.1`
- npm: `11.11.0`
- database: локальный `PostgreSQL` в Docker-контейнере `merchshop-postgres`
- migration state: applied

## Checks Passed

### Build

- `npm run build` в `backend/` проходит успешно

### Runtime

- `GET /api/health` возвращает `200`
- backend успешно стартует на мигрированной схеме
- warning `Unsupported route path: "/api/*"` больше не появляется после замены `forRoutes('*')` на named wildcard

### Auth And Onboarding Flow

Успешно пройден следующий happy path:

1. `POST /api/auth/bootstrap-admin`
2. `POST /api/auth/login`
3. `POST /api/employees`
4. `POST /api/auth/invite`
5. `POST /api/auth/password/complete`
6. `GET /api/auth/session` под employee JWT
7. `POST /api/auth/password/reset-token`
8. `POST /api/auth/password/complete` для reset flow
9. `POST /api/auth/login` сотрудника с новым паролем

Подтверждено в ходе проверки:

- сотрудник создается со связанным локальным `User`
- стартовый статус employee user: `INVITED`
- после завершения invite flow статус становится `ACTIVE`
- `auth/session` возвращает корректные `role` и `employeeId`
- reset-password flow выдает новый token и позволяет войти с новым паролем

## Not Covered

В этот smoke-report не входили:

- Excel import сотрудников
- SMTP/email доставка invite/reset token
- expiration scheduler и сгорание баллов
- catalog CRUD beyond current baseline
- order lifecycle beyond текущие ранее выполненные выборочные проверки
- отдельные automated tests, потому что test suite пока не добавлен в `package.json`

## Notes

- Для runtime smoke-check backend поднимался во временном Docker-контейнере в одном network namespace с локальным Postgres, так как прямой запуск backend на хосте в текущем окружении не видел `localhost:5432`.
- После проверки временные backend-контейнеры были остановлены.
- Локальный контейнер БД `merchshop-postgres` оставлен запущенным для дальнейшей разработки.
