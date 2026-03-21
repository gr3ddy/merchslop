# Backend Backup / Restore Checklist

Практический checklist для `Merchshop backend` на `PostgreSQL + Prisma`.

Документ покрывает:

- backup базы данных
- backup загруженных файлов каталога
- restore в отдельную БД для проверки
- post-restore verification

Не покрывает:

- автоматическое расписание backup-ов
- offsite storage policy
- production monitoring

## Что нужно сохранять

Для полноценного recovery нужен не только dump БД.

Минимальный recovery bundle:

1. dump PostgreSQL
2. архив `backend/uploads`
3. копия актуального `.env` или безопасно сохраненные значения runtime config

Почему это важно:

- `ProductImage.filePath` хранится в БД
- сами файлы изображений лежат в `backend/uploads`
- восстановление одной только БД оставит битые ссылки на изображения

## Предпосылки

- доступен `DATABASE_URL`
- установлены PostgreSQL client tools: `pg_dump`, `pg_restore`, `psql`, `createdb`, `dropdb`
- для локального Docker-сценария запущен контейнер PostgreSQL, который слушает тот же `localhost:5432`, что и в `backend/.env`

Текущий локальный dev URL в проекте:

```bash
postgresql://postgres:postgres@localhost:5432/merchshop?schema=public
```

## Backup Checklist

### 1. Подготовка

- убедиться, что backup делается в момент низкой нагрузки или в maintenance window
- убедиться, что `DATABASE_URL` указывает на правильную БД
- создать каталог для артефактов backup

Пример:

```bash
mkdir -p /tmp/merchshop-backups
export BACKUP_STAMP="$(date +%Y%m%d-%H%M%S)"
export BACKUP_DIR="/tmp/merchshop-backups/$BACKUP_STAMP"
mkdir -p "$BACKUP_DIR"
```

### 2. Снять dump PostgreSQL

Рекомендуемый формат: `custom`, чтобы потом можно было использовать `pg_restore`.

```bash
cd /Users/gredd/Code/merchslop/backend
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"

pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$BACKUP_DIR/merchshop.dump" \
  "$DATABASE_URL"
```

### 3. Снять backup загруженных файлов

```bash
cd /Users/gredd/Code/merchslop
tar -czf "$BACKUP_DIR/uploads.tar.gz" backend/uploads
```

Если `backend/uploads` пока пустой, архив всё равно полезен как подтверждение состояния.

### 4. Сохранить runtime config snapshot

Не храните секреты в небезопасном месте. Если backup уходит во внешний storage, `.env` должен быть зашифрован или заменён на защищённый secret record.

Локальный пример:

```bash
cp /Users/gredd/Code/merchslop/backend/.env "$BACKUP_DIR/backend.env.snapshot"
```

### 5. Быстрая проверка backup артефактов

```bash
ls -lh "$BACKUP_DIR"
pg_restore --list "$BACKUP_DIR/merchshop.dump" | head
tar -tzf "$BACKUP_DIR/uploads.tar.gz" | head
```

Ожидаемый результат:

- `merchshop.dump` существует и не пустой
- `pg_restore --list` читает dump без ошибки
- архив `uploads.tar.gz` открывается

## Restore Checklist

Restore лучше сначала проверять не в основную БД, а в отдельную временную.

### 1. Создать временную restore-БД

```bash
export RESTORE_DB_NAME="merchshop_restore_$BACKUP_STAMP"
createdb -h localhost -p 5432 -U postgres "$RESTORE_DB_NAME"
export RESTORE_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/$RESTORE_DB_NAME?schema=public"
```

### 2. Развернуть dump

```bash
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$RESTORE_DATABASE_URL" \
  "$BACKUP_DIR/merchshop.dump"
```

### 3. Развернуть `uploads`

Если проверка идет в отдельном workspace, распакуйте архив рядом с backend.

Пример локальной проверки:

```bash
mkdir -p /tmp/merchshop-restore-check
tar -xzf "$BACKUP_DIR/uploads.tar.gz" -C /tmp/merchshop-restore-check
```

### 4. Проверить Prisma migration state

```bash
cd /Users/gredd/Code/merchslop/backend
DATABASE_URL="$RESTORE_DATABASE_URL" npx prisma migrate status
```

Ожидаемый результат:

```text
Database schema is up to date!
```

### 5. Проверить базовые данные

```bash
psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) AS users_count FROM "User";'
psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) AS employees_count FROM "Employee";'
psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) AS products_count FROM "Product";'
psql "$RESTORE_DATABASE_URL" -c 'SELECT count(*) AS orders_count FROM "Order";'
psql "$RESTORE_DATABASE_URL" -c 'SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at DESC;'
```

### 6. Runtime smoke against restored DB

Поднимите backend с `DATABASE_URL="$RESTORE_DATABASE_URL"` и проверьте:

- `GET /api/health`
- `POST /api/auth/login` для известного admin user
- `GET /api/catalog/products`
- `GET /api/orders` под admin context
- если в restore есть изображения, открыть один `ProductImage.filePath`

Пример:

```bash
cd /Users/gredd/Code/merchslop/backend
DATABASE_URL="$RESTORE_DATABASE_URL" npm run start:dev
```

## Post-Restore Verification Checklist

Минимум должно выполняться следующее:

- `npx prisma migrate status` сообщает `Database schema is up to date!`
- backend стартует без migration/drift ошибок
- можно войти под admin account
- counts по основным таблицам выглядят разумно
- `backend/uploads` восстановлен отдельно от dump
- catalog image URLs не ведут на отсутствующие файлы

## Cleanup Checklist

После тестового restore:

```bash
dropdb -h localhost -p 5432 -U postgres "$RESTORE_DB_NAME"
```

Если использовалась временная файловая директория:

```bash
rm -rf /tmp/merchshop-restore-check
```

## Минимальная периодичность

Для MVP-этапа разумный baseline такой:

- ежедневный backup PostgreSQL
- backup `backend/uploads` с той же периодичностью
- отдельная restore-проверка хотя бы раз в месяц или перед важным релизом

## Recovery Sign-off

Checklist можно считать выполненным, если:

1. есть свежий dump БД
2. есть архив `backend/uploads`
3. есть способ восстановить `.env` / secrets
4. выполнен хотя бы один успешный test restore в отдельную БД
