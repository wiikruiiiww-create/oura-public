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
   Команда выведет `OURA_SERVICE_NSEC` и `OURA_SERVICE_PUBKEY` — сохрани их.

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

## Проверено на стенде

_заполняется по итогам сквозного демо_
