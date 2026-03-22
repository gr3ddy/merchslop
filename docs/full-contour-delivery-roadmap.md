# Full Contour Delivery Roadmap

## Назначение

Документ раскладывает `полный контур` системы `Merchshop` на последовательные этапы поставки, опираясь на:

- [Техническое Задание Мерчшоп.pdf](../Техническое%20Задание%20Мерчшоп.pdf)
- [docs/backend-acceptance-pass-2026-03-21.md](./backend-acceptance-pass-2026-03-21.md)
- [docs/full-contour-scope-decisions.md](./full-contour-scope-decisions.md)
- [docs/mvp-template-foundation.md](./mvp-template-foundation.md)

Цель roadmap:

- перевести формулировку `полный контур` из ТЗ в исполнимый delivery-plan
- зафиксировать, что уже закрыто текущим backend
- определить последовательность релизов и exit criteria

## Стартовая точка

На момент составления roadmap:

- backend `MVP core` закрыт и зафиксирован как `accepted`
- текущий backend уже покрывает:
  - auth/onboarding
  - employees import
  - ledger/balance
  - catalog
  - persisted cart
  - orders
  - notifications
  - reports/export
  - expiration
  - audit
  - SMTP notifications
  - базовый hardening

Это означает, что дальнейший delivery full contour упирается не в фундамент backend, а в:

- полноценный frontend/web contour
- расширение ролей и workflow
- интеграции
- расширенную аналитику
- миграцию, пилот и запуск

## Ключевые решения для full contour

Для целей этого roadmap считаем, что продуктовый выбор уже сделан в пользу:

- `full contour`, а не только `MVP`
- web-first реализации
- поэтапной поставки вертикальными срезами
- сохранения уже построенного backend как ядра, а не переписывания с нуля

Допущение:

- `mobile access` из ТЗ трактуется как адаптивный web/PWA-friendly contour, а не как отдельное native-приложение в первой волне полного контура

Если позже будет выбран отдельный native mobile track, он станет дополнительным release train поверх этого roadmap.

## Что входит в full contour по ТЗ

Крупные блоки из ТЗ, которые выходят за пределы уже собранного backend MVP:

- полный пользовательский web contour для всех ролей
- расширенная ролевая модель: `Manager`, `Super Admin`, `Auditor`, `Merch Operator`
- workflow согласования крупных начислений и корректировок
- автоматические правила начислений
- гибкие сроки жизни баллов по типам начислений/кампаниям
- журнал входов
- расширенный audit trail
- интеграция с `HR system`
- `SSO / AD / LDAP`
- интеграция с порталом/intranet
- интеграция с `ERP / WMS`
- BI / DWH / export API
- дашборды и аналитика вовлеченности
- кампании, акции, достижения, feedback, ratings, personalization
- полная миграция данных
- UAT, pilot, industrial rollout

## Delivery Principles

1. Каждый релиз должен быть вертикальным и демонстрируемым.
2. Нельзя откладывать frontend до самого конца: основной риск полного контура уже сместился туда.
3. Интеграции не должны блокировать базовый пользовательский запуск, если full contour можно сначала отработать на локальных данных.
4. Роли и workflow должны вводиться после того, как есть реальные UI-поверхности для соответствующих пользователей.
5. Миграцию, UAT и pilot нужно планировать как отдельный поток, а не как post-factum активность.

## Release Plan

### R0. Program Definition and Freeze

Цель:

- зафиксировать final scope полного контура до активной UI и integration-разработки

Состав:

- выбор финальной ролевой модели
- выбор обязательных интеграций первой волны
- решение по `mobile access`
- решение по глубине полной миграции
- согласование KPI, pilot scope и success criteria
- детализация backlog по релизам

Выход:

- финализированное scope statement
- decision log по спорным пунктам полного контура
- release backlog
- архитектурная схема full contour
- UX map по ролям

Зависимости:

- участие Product Owner, HR, IT/ИБ

Оценка:

- `2–3 недели`

### R1. Employee Web Contour

Цель:

- дать сотруднику полностью рабочий пользовательский контур поверх уже существующего backend

Состав:

- экран логина
- личный кабинет сотрудника
- баланс и история операций
- каталог с поиском, фильтрацией и карточкой товара
- persisted cart
- checkout и история заказов
- in-app notifications center
- базовые email-trigger expectations в UX
- responsive layout для desktop / tablet / mobile browser

Что используем из уже готового backend:

- auth/session
- catalog
- cart
- orders
- notifications
- reports не обязательны для employee flow

Exit criteria:

- сотрудник может пройти полный happy path `login -> catalog -> cart -> checkout -> order tracking`
- UI адаптивен
- нет критичных дефектов в employee сценариях

Оценка:

- `5–7 недель`

### R2. Admin / HR / Merch Operator Web Contour

Цель:

- закрыть внутренний операционный контур системы для администрирования программы

Состав:

- admin dashboard
- employees import и employee directory UI
- manual accrual / adjustment UI
- catalog admin UI
- stock management UI
- order processing UI
- reports and export UI
- audit log viewer
- company settings UI

Что используем из уже готового backend:

- employees
- transactions
- catalog admin
- orders admin flow
- reports/export
- audit
- company settings

Дополнительно:

- подготовка UI-структуры под будущие роли `Manager`, `Auditor`, `Merch Operator`

Exit criteria:

- HR/admin может администрировать программу без прямой работы через Swagger/API
- оператор мерча может проводить заказ по статусам
- все основные административные действия доступны через интерфейс

Оценка:

- `6–8 недель`

### R3. Role Expansion and Workflow Layer

Цель:

- перейти от `MVP`-ролей к полной организационной модели из ТЗ

Состав:

- выделение ролей `Manager`, `Super Admin`, `Auditor`, `Merch Operator`
- разграничение прав по ролям и подразделениям
- журнал входов
- workflow согласования крупных начислений
- workflow согласования ручных корректировок
- начисления руководителем подчинённым
- лимиты по роли / периоду / операции
- базовый антифрод и блокировки по порогам
- гибкие правила срока действия баллов по типам начислений

Технический эффект:

- понадобится расширение доменной модели, UI и audit semantics

Exit criteria:

- права соответствуют роли и подразделению
- критичные операции проходят через утверждённый workflow
- audit и login journal покрывают новые административные сценарии

Оценка:

- `5–7 недель`

### R4. Automation and Program Mechanics

Цель:

- превратить систему из ручного операционного инструмента в реальную платформу программы мотивации

Состав:

- автоматические правила начислений по событиям
- конфигурируемые кампании
- расширенные уведомления
- flexible expiration policies
- готовые правила по стажу / юбилеям / активностям
- управление справочниками и правилами через UI

Дополнительно:

- базовая программа достижений и признания, если это попадает в первую волну full contour

Exit criteria:

- не все начисления требуют ручного действия HR
- программа может работать по правилам и расписанию
- бизнес видит управляемую механику кампаний

Оценка:

- `4–6 недель`

### R5. Integration Wave 1

Цель:

- встроить систему в корпоративную инфраструктуру пользователя

Состав:

- HR-system sync
- org structure sync
- manager hierarchy sync
- увольнение / деактивация через sync
- `SSO / AD / LDAP / OIDC/SAML` в выбранном формате
- портал/intranet embedding
- корпоративные каналы коммуникаций в пределах выбранного ландшафта

Приоритет внутри релиза:

1. HR sync
2. SSO
3. portal embedding

Exit criteria:

- сотрудники и оргструктура приходят автоматически
- корпоративная авторизация работает
- деактивация в source system закрывает доступ в Merchshop

Оценка:

- `6–8 недель`

### R6. Integration Wave 2 and Analytics

Цель:

- закрыть enterprise-аналитику и операционные интеграции с каталогом/остатками

Состав:

- `ERP / WMS` sync по номенклатуре и остаткам
- hourly stock refresh или согласованная альтернатива
- BI export API
- выгрузки в DWH
- dashboard layer
- MAU / WAU / conversion / popularity / budget analytics
- anomaly reporting

Exit criteria:

- остатки и номенклатура синхронизируются из внешней системы или в согласованном hybrid-mode
- руководство получает аналитический контур из ТЗ
- данные доступны для BI без ручной сборки из транзакционных экранов

Оценка:

- `6–8 недель`

### R7. Engagement and Personalization

Цель:

- закрыть верхний слой full contour, который отвечает за вовлечённость, а не только за учёт

Состав:

- ratings / feedback on products
- mini-surveys
- segmentation
- recommendations
- achievements / badges
- campaigns / promotions
- leaderboard / recognition mechanics

Примечание:

- этот релиз должен идти только после того, как базовый операционный и интеграционный контур стабилен

Exit criteria:

- full contour покрывает не только операции, но и механику вовлечения из ТЗ

Оценка:

- `5–8 недель`

### R8. Full Migration, UAT, Pilot, Go-Live

Цель:

- перевести продукт из готовности к разработке в готовность к реальной эксплуатации

Состав:

- анализ legacy Excel data
- подготовка migration tooling
- test migration
- full migration rehearsal
- security testing
- load testing
- cross-browser testing
- UAT
- обучение пользователей
- pilot `50–200` пользователей
- parallel run with Excel
- cutover
- production launch
- warranty support

Exit criteria:

- полная или согласованная миграция завершена
- pilot успешен
- нет critical/high дефектов
- UAT подписан
- production cutover завершён

Оценка:

- `8–12 недель`

## Cross-Cutting Tracks

Эти потоки не живут отдельным релизом, а должны идти сквозь весь roadmap:

### 1. UX / Design System

- wireframes
- visual system
- component library
- responsive patterns
- accessibility baseline

### 2. QA Track

- unit / integration / e2e
- regression suite
- test data strategy
- UAT scenario packs

### 3. Security / Compliance

- secrets handling
- role audits
- SAST / DAST
- pen-test readiness
- personal data handling

### 4. Documentation / Enablement

- admin guide
- employee guide
- merch operator guide
- API docs
- support playbooks

### 5. DevOps / Operations

- environments
- CI/CD
- observability
- release process
- backup/restore drills
- incident handling

## Recommended Execution Order

Если идти не абстрактно, а практично от текущего состояния репозитория, рекомендуемый порядок такой:

1. `R0` — scope freeze for full contour
2. `R1` — employee web
3. `R2` — admin / HR / merch operator web
4. `R3` — role expansion and workflow
5. `R5` — HR sync + SSO
6. `R4` — automation and program mechanics
7. `R6` — ERP/WMS + analytics/BI
8. `R7` — engagement/personalization
9. `R8` — migration, UAT, pilot, go-live

Почему именно так:

- сначала нужен работающий интерфейс для основных ролей
- потом можно безопасно расширять модель ролей и согласований
- интеграции первой волны лучше вводить, когда UI и доменная модель уже стабилизировались
- сложную аналитику и engagement-механику разумнее строить на устойчивом основании

## Main Risks for Full Contour

1. Попытка делать все роли, UI, интеграции и аналитику параллельно размоет delivery и сорвёт сроки.
2. Недоформализованная ролевая модель приведёт к переделке UI и backend authorization позже.
3. Интеграции с `HR/SSO/ERP/WMS` могут съесть непропорционально много времени, если не пройти техническое обследование заранее.
4. Полная миграция исторических данных из Excel почти наверняка потребует отдельной очистки и нормализации.
5. Full contour без сильного UX трека рискует формально закрыть ТЗ, но провалиться по реальному использованию.

## Next Concrete Step

Следующий рациональный шаг после этого roadmap:

1. провести `R0`-сессию и выбрать финальные варианты спорных пунктов полного контура
2. после этого сразу открыть delivery stream `R1 Employee Web Contour`

Если нужно не обсуждение, а реальное начало работ, первой практической задачей я бы брал:

- проектирование структуры frontend-приложения и списка экранов для `R1`
- затем реализацию employee web vertical slice `login -> cabinet -> catalog -> cart -> checkout -> orders`
