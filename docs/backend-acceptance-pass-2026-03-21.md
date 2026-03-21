# Backend Acceptance Pass 2026-03-21

## Scope

Acceptance-pass выполнен для `backend`-контура `Merchshop MVP` относительно [docs/mvp-template-foundation.md](./mvp-template-foundation.md).

Что входило в проверку:

- сверка текущего backend-кода с MVP-чеклистом и обязательными бизнес-правилами
- сверка текущего test baseline
- актуальный прогон `npm run test:critical`

Что не входило в проверку:

- frontend/UI acceptance
- P1 production hardening вне backend MVP core

## Verification Baseline

- `npm run test:critical` — `9/9 pass`
- ранее зафиксированный ручной smoke: [docs/smoke-test-report-2026-03-12.md](./smoke-test-report-2026-03-12.md)
- live SMTP smoke-test against temporary `Mailpit` on `2026-03-21` — business emails for accrual, orders and expiration confirmed

Текущий automated baseline покрывает:

- employee onboarding: `invite -> password complete -> reset`
- order flow: `reserve -> confirm -> cancel`
- persisted cart: item storage, metadata update and checkout into `Order`
- expiration warning и expiration sweep
- notifications read-flow
- catalog happy path
- upload validation for employee import and catalog images
- employees import с `ImportJob` и partial success
- reports list + CSV export

## Acceptance Summary

Итоговый статус backend на текущем этапе: `accepted with reservations`.

Это означает:

- backend закрывает основное MVP-ядро
- обязательные бизнес-правила backend-слоя выглядят выполненными
- есть несколько открытых оговорок, которые не ломают основной контур, но важны для финального product acceptance

## MVP Checklist Status

| Область | Статус | Комментарий |
|---|---|---|
| Платформенный фундамент | Done | `NestJS`, Prisma, config, Swagger, RBAC, actor context, audit, static assets для `uploads` |
| Локальная авторизация | Done | `bootstrap-admin`, `login`, `invite/reset-password`, employee account binding |
| Сотрудники и импорт | Done | Excel import, валидация, `ImportJob`, активация/деактивация, локальный `User` |
| Ledger и баланс | Done | `Transaction`, `BalanceSnapshot`, accrual, adjustment, rebuild, retry для serializable конфликтов |
| Каталог | Done | категории, CRUD товаров, остатки, фото, публичная раздача изображений |
| Persisted cart | Done | отдельные `Cart`/`CartItem`, сохраненный `pickupPoint/comment`, checkout через `POST /cart/checkout` |
| Заказы | Done | создание заказа, резерв, admin status flow, confirm/write-off, cancel/release |
| In-app уведомления | Done | события, список, summary, `mark as read`, `mark all as read` |
| SMTP-адаптер | Done | SMTP-слой подключен для auth invite/reset, balance events, order events и expiration events |
| Отчеты и экспорт | Done | balances, transactions, orders, expirations, CSV export |
| Сгорание | Done | global settings, warning scheduler, expiration scheduler, report по expirations |
| Аудит | Done | критичные действия по балансу, каталогу, заказам, import/auth flow аудируются |
| Critical automated tests | Done | ключевые бизнес-потоки покрыты и проходят |

## Business Rules Check

| Правило | Статус | Комментарий |
|---|---|---|
| 1. Любое изменение баланса создает `Transaction` | Done | covered code + e2e |
| 2. При создании заказа баллы резервируются, а не списываются | Done | covered code + e2e |
| 3. При подтверждении заказа резерв превращается в списание | Done | covered code + e2e |
| 4. При отмене резерв возвращается отдельной транзакцией | Done | covered code + e2e |
| 5. Ручная корректировка требует причину и комментарий | Done | DTO и service logic согласованы |
| 6. Остаток товара уменьшается только после подтверждения | Done | covered code + e2e |
| 7. Сгорание выполняется фоновым процессом | Done | scheduler + service + report |
| 8. Импорт валидирует уникальность табельного номера и email | Done | service logic + e2e |
| 9. Неактивный сотрудник не может войти и оформить заказ | Done | status checks есть в auth/orders flow |
| 10. Критичные admin-действия аудируются | Done | balance/catalog/order/import/auth events присутствуют |

## Open Reservations

### 1. P1 hardening еще открыт

Не закрыты пункты из `P1. Усиление решения`:

- monitoring/error tracking

Что уже закрыто в этом блоке:

- checklist backup/restore в [docs/backend-backup-restore-checklist.md](./backend-backup-restore-checklist.md)
- дополнительные ограничения и валидация upload-ов

Это не блокирует backend MVP core, но блокирует production-hardening acceptance.

## Decision

На текущем срезе backend можно считать `MVP-ready` для основной доменной логики и внутренних интеграционных работ.

Для полного acceptance без оговорок рекомендовано закрыть:

1. Минимальный P1 hardening package
