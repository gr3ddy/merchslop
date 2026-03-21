# Merchshop Backend

Стартовый backend-каркас для `Merchshop MVP` на `NestJS` по модели `modular monolith`.

## Что уже заложено

- базовая структура backend-проекта
- глобальная конфигурация через env
- `Swagger`
- локальная `JWT`-авторизация с bootstrap первого администратора
- `RBAC`-каркас
- `actor context` через `Bearer`-токен или временные HTTP-заголовки для ранней разработки
- Prisma schema под ключевые сущности MVP
- стартовые доменные модули

## Временная модель actor context

Backend уже умеет работать с `Bearer` JWT, но для ранней интеграции защищенные endpoint-ы по-прежнему можно дергать с временными заголовками:

- `x-user-id`
- `x-user-role`
- `x-employee-id`

## Первый запуск auth

Если в системе еще нет пользователей, сначала создайте первого администратора:

```bash
curl -X POST http://localhost:3000/api/auth/bootstrap-admin \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@company.local","password":"StrongPass123!"}'
```

После этого можно получить токен:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@company.local","password":"StrongPass123!"}'
```

И использовать `Authorization: Bearer <token>`.

Пример admin-запроса:

```bash
curl -X PATCH http://localhost:3000/api/company-settings \
  -H 'Content-Type: application/json' \
  -H 'x-user-id: 00000000-0000-0000-0000-000000000001' \
  -H 'x-user-role: PROGRAM_ADMIN' \
  -d '{"companyName":"Acme Corp"}'
```

## Быстрый старт

1. Установить `Node.js 24` или совместимую `LTS`-версию.
2. Скопировать `.env.example` в `.env`.
3. Установить зависимости:

```bash
npm install
```

4. Сгенерировать Prisma client:

```bash
npm run prisma:generate
```

5. Применить миграции:

```bash
npm run prisma:migrate:dev
```

6. Запустить dev-сервер:

```bash
npm run start:dev
```

## Critical automated tests

Минимальный e2e-baseline на ключевые бизнес-потоки можно прогнать так:

```bash
npm run test:critical
```

Что проверяется:

- employee onboarding через `invite -> password complete -> reset password`
- заказ через `reserve -> confirm -> cancel`
- persisted cart: сохранение items, pickup point/comment и checkout в `Order`
- `expiration warning` и `expiration sweep`
- `notifications` summary/read flow
- базовый happy path каталога
- upload validation для `employees/import` и catalog images
- `employees import` с partial success и `ImportJob`
- `reports` list + CSV export для balances, transactions, orders и expirations

Для запуска нужен доступный PostgreSQL по `DATABASE_URL` из `.env`.

## SMTP для invite/reset и business notifications

Чтобы письма по auth и ключевым бизнес-событиям уходили по email, заполните SMTP-переменные в `.env` и включите `smtpEnabled` в `company-settings`:

```bash
curl -X PATCH http://localhost:3000/api/company-settings \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <admin-token>' \
  -d '{"smtpEnabled":true}'
```

Сейчас SMTP используется для:

- `invite`
- `reset-password`
- начислений и корректировок баланса
- жизненного цикла заказов
- предупреждений о скором сгорании и факта сгорания баллов

Если `smtpEnabled=false` или SMTP не сконфигурирован, backend сохраняет текущий fallback:

- invite/reset endpoint-ы продолжают работать
- plain token возвращается в API-ответе для ручной передачи сотруднику
- при успешной email-доставке токен в ответ больше не возвращается
- бизнес-события продолжают приходить как `in-app` уведомления без ошибки backend flow

## Static assets для каталога

Загруженные изображения товаров раздаются backend-ом как static assets по пути `/uploads/*`.

- файлы сохраняются в `backend/uploads/catalog/...`
- поле `filePath` у `ProductImage` можно использовать как публичный путь относительно backend origin
- пример: если `filePath` равен `uploads/catalog/<productId>/<file>`, то публичный URL будет `http://localhost:3000/uploads/catalog/<productId>/<file>`

## Persisted cart

Backend теперь поддерживает отдельную сохраненную корзину сотрудника.

Доступные endpoint-ы:

- `GET /api/cart`
- `PATCH /api/cart`
- `PUT /api/cart/items/:productId`
- `DELETE /api/cart/items/:productId`
- `DELETE /api/cart`
- `POST /api/cart/checkout`

Что хранится в корзине:

- позиции `CartItem`
- выбранный `pickupPointId`
- комментарий к будущему checkout

`POST /api/cart/checkout` использует ту же order-логику, что и прямой `POST /api/orders`, но берет items и checkout metadata из persisted корзины и очищает ее после успешного создания заказа.

## Backup / Restore

Операционный checklist для backup и test-restore лежит в [docs/backend-backup-restore-checklist.md](../docs/backend-backup-restore-checklist.md).

Он покрывает:

- `pg_dump` backup базы
- backup `backend/uploads`
- restore в отдельную PostgreSQL БД
- post-restore verification через Prisma и runtime smoke

## Upload limits / validation

На текущем этапе backend ограничивает upload-ы так:

- catalog images: только `.jpg`, `.jpeg`, `.png`, `.webp`, максимум `5 MB`
- employee import: только `.xlsx`, максимум `2 MB`

Проверка идёт на уровне interceptor-а и сервисной валидации, чтобы слишком большие или неподходящие файлы отсеивались как можно раньше и с понятной ошибкой API.
