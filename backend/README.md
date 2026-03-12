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

## Следующий слой реализации

- создание employee user-аккаунтов и invite flow
- импорт сотрудников из Excel
- каталог и заказы с реальным persistence-слоем
- workflow резервирования и списания баллов по заказам
