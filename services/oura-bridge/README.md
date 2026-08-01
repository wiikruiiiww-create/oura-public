# OURA Bridge — Фаза 0

**Назначение.** Мост Фазы 0 OURA: внешний диалог (заглушка Telegram) → канал buzz от имени лид-идентичности; ответ оператора → обратно. Фаза 0 использует HTTP-заглушку вместо реального Telegram — реальный адаптер придёт в Фазе 1.

## Env-переменные

| Переменная | Значение по умолчанию | Описание |
|---|---|---|
| `OURA_SERVICE_NSEC` | (обязателен) | Nostr nsec (приватный ключ) сервиса |
| `OURA_SERVICE_PUBKEY` | (обязателен) | Hex pubkey сервиса |
| `OURA_RELAY_URL` | `http://localhost:3000` | URL relay (Nostr) |
| `OURA_BUZZ_BIN` | `<repo>/target/debug/buzz` | Путь к бинарнику buzz-cli |
| `OURA_STUB_PORT` | `8787` | Порт HTTP-заглушки Telegram |
| `OURA_STATE_FILE` | `./bridge.state.json` | Путь к файлу состояния |
| `OURA_OPERATOR_PUBKEY` | (опционально) | Pubkey оператора (для маршрутизации ответов) |
| `OURA_POLL_MS` | `2000` | Интервал поллинга исходящих (ms) |
| `OURA_SOURCE` | `stub` | Источник внешнего канала: `stub` (HTTP-заглушка) или `telegram` (реальный бот) |
| `OURA_TELEGRAM_TOKEN` | (обязателен при `OURA_SOURCE=telegram`) | Токен бота от @BotFather |
| `OURA_OPERATOR_PUBKEYS` | (пусто) | Hex-pubkey операторов через запятую: добавляются в каналы лидов, ТОЛЬКО их ответы уходят клиенту. Пусто = любой участник (допустимо только на дев-стенде). Старое имя `OURA_OPERATOR_PUBKEY` читается как алиас |

## Stand-запуск

1. В первом терминале запусти relay:
   ```bash
   just relay
   ```

2. Собери buzz-cli:
   ```bash
   cargo build -p buzz-cli
   ```

3. Сгенерируй ключ сервиса:
   ```bash
   pnpm --filter @oura/bridge mint-key
   ```
   Команда выведет JSON `{nsec, pubkeyHex}` — присвой `nsec` → `OURA_SERVICE_NSEC`, `pubkeyHex` → `OURA_SERVICE_PUBKEY`.

4. Экспортируй ключи в окружение:
   ```bash
   export OURA_SERVICE_NSEC=<значение>
   export OURA_SERVICE_PUBKEY=<значение>
   ```

5. Запусти сервис в отдельном терминале:
   ```bash
   pnpm --filter @oura/bridge dev
   ```

## Демо-сценарий

### Входящее сообщение (заглушка Telegram)

Отправь сообщение от клиента через HTTP-заглушку:
```bash
curl -X POST http://127.0.0.1:8787/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "42",
    "name": "Иван",
    "text": "Здравствуйте! Сколько стоит доставка?"
  }'
```

Ожидаемый результат: сообщение попадёт в buzz-канал от имени лид-идентичности, логи покажут `[inbound] chat 42 (Иван) → комната лида`.

### Проверка в buzz

Убедись, что сообщение попало:
```bash
buzz messages get
```

### Ответ оператора

В отдельном окне запусти десктопный клиент buzz:
```bash
just desktop-standalone
```

Найди комнату лида, ответь на сообщение. Ответ будет поставлен в исходящую очередь.

### Проверка исходящих (outbox)

Получи ответ оператора через заглушку:
```bash
curl -X GET http://127.0.0.1:8787/outbox
```

Ожидаемый результат: JSON с массивом исходящих сообщений.

## Реальный Telegram

1. Создай бота у @BotFather (`/newbot`), получи токен.
2. `export OURA_SOURCE=telegram OURA_TELEGRAM_TOKEN=<токен>`
3. Запусти мост: `pnpm --filter @oura/bridge dev`. В логе появится `[telegram] бот @<имя>` и `long-polling запущен`; мёртвый токен уронит процесс сразу (fail-fast).
4. Напиши боту в Telegram с любого аккаунта → в buzz появится канал `inbox-<имя>-<chat.id>`.
5. Ответ оператора в канале → приходит в Telegram-чат. Сообщения длиннее 4096 символов режутся на части.

Ограничения первой итерации: только текст (голос/фото/видео/стикеры игнорируются молча), инлайн-кнопок нет, один бот на процесс. Клиент заблокировал бота → сообщение помечается необратимо недоставленным, поллер не зацикливается. Сообщение длиннее 4096 символов при сетевом сбое посреди отправки может частично задублироваться при повторе (низкая вероятность: на каждый кусок уже есть 3 попытки); персистентный курсор отправки придёт с переходом состояния на Postgres. Сбой обработки входящего (например, relay недоступен) теряет это входящее — очереди в Фазе 1 нет, offset у Telegram уходит вперёд.

## Проверено на стенде

Дата: 2026-07-31. Сквозное демо пройдено полностью на локальном стенде (relay `cargo run -p buzz-relay` дев-сборка, Docker: postgres:17-alpine + redis:7-alpine + minio).

**Сценарий и фактические результаты:**

1. `POST /simulate` `{"chatId":"42","name":"Иван","text":"Здравствуйте! Сколько стоит доставка?"}` → мост заминтил лид-идентичность, создал канал `inbox-иван-42`, отправил сообщение от имени лида. Лог: `[inbound] chat 42 (Иван) → комната лида`.
2. `buzz messages get --channel <id>` (сервисный ключ) вернул сообщение лида: kind:9, тег `["h", <channel-uuid>]`; `channels members` — сервис `owner`, лид `member`.
3. Ответ оператора (вторая идентичность: `mint-key` → `channels add-member` → `messages send`) → в течение одного поллинга появился в `GET /outbox`: `[{"chatId":"42","text":"Добрый день, Иван! ..."}]`. Повторные поллинги дублей не дают.
4. Рестарт моста + новое входящее того же чата → канал НЕ пересоздан (тот же uuid из `bridge.state.json`), ответы не задублированы.

**Фактические формы JSON buzz-cli** (нормализатор `cli-client.ts` покрывает их основной веткой):
- `messages get` → массив `{id, pubkey, content, created_at, kind, tags}`;
- `messages send` → `{accepted: true, event_id, message}`;
- `channels create` → объект с `id` (uuid канала);
- `channels members` → массив `{pubkey, role}`.

**Нюансы стенда (macOS этой машины):**
- Порт 5432 занят homebrew-postgres, 5433 — другой dev-БД → постгрес buzz уведён на **5434** через `docker-compose.override.yml` (файл в `.git/info/exclude`, в репо не входит); в `.env`: `DATABASE_URL=...:5434/buzz` и `PGPORT=5434`.
- `buzz-admin migrate` НЕ читает `.env` — нужен явный `DATABASE_URL=postgres://buzz:buzz_dev@localhost:5434/buzz ./target/debug/buzz-admin migrate`.
- Relay требует MinIO (`docker compose up -d minio minio-init`) — без него падает на git conformance probe.
- Ключи стенда лежат в `services/oura-bridge/.env` (гитигнорен).
