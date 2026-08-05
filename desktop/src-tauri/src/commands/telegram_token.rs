//! Проверка токена Telegram-бота перед сохранением агента: пользователь видит
//! имя бота ещё в форме, а не узнаёт об опечатке из логов сервиса лидов.
//!
//! Токен — секрет: он не попадает ни в текст ошибок, ни в логи. Ошибки
//! формулируются по смыслу («токен отклонён Telegram»), без эха значения.

use std::time::Duration;

use serde::{Deserialize, Serialize};

const GET_ME_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_GET_ME_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BotIdentity {
    pub username: String,
    pub bot_id: i64,
}

#[derive(Deserialize)]
struct GetMeResponse {
    ok: bool,
    result: Option<GetMeResult>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct GetMeResult {
    id: i64,
    username: Option<String>,
}

/// Формат токена BotFather: `<id>:<секрет>`. Проверяется до сетевого вызова,
/// чтобы очевидная опечатка не уходила в интернет.
fn is_plausible_token(token: &str) -> bool {
    let Some((id, secret)) = token.split_once(':') else {
        return false;
    };
    !id.is_empty()
        && id.chars().all(|c| c.is_ascii_digit())
        && secret.len() >= 20
        && secret
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Разбор ответа `getMe`; ошибка описывает причину, не повторяя токен.
fn parse_get_me(body: &str) -> Result<BotIdentity, String> {
    let parsed: GetMeResponse =
        serde_json::from_str(body).map_err(|_| "Telegram вернул неожиданный ответ".to_string())?;
    if !parsed.ok {
        return Err(match parsed.description.as_deref() {
            Some("Unauthorized") | None => "токен отклонён Telegram".to_string(),
            Some(other) => format!("Telegram отклонил токен: {other}"),
        });
    }
    let result = parsed
        .result
        .ok_or_else(|| "Telegram вернул ответ без данных бота".to_string())?;
    let username = result
        .username
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "у бота нет username — задайте его в @BotFather".to_string())?;
    Ok(BotIdentity {
        username,
        bot_id: result.id,
    })
}

/// Проверяет токен бота вызовом `getMe` и возвращает его имя и id.
#[tauri::command]
pub async fn validate_telegram_bot_token(token: String) -> Result<BotIdentity, String> {
    let token = token.trim().to_string();
    if !is_plausible_token(&token) {
        return Err("токен не похож на выданный @BotFather (формат <id>:<секрет>)".to_string());
    }

    let client = reqwest::Client::builder()
        .pool_idle_timeout(Duration::from_secs(10))
        .pool_max_idle_per_host(1)
        .build()
        .map_err(|_| "не удалось создать HTTP-клиент".to_string())?;

    let request = client.get(format!("https://api.telegram.org/bot{token}/getMe"));
    let response = tokio::time::timeout(GET_ME_TIMEOUT, request.send())
        .await
        .map_err(|_| "Telegram не ответил вовремя".to_string())?
        .map_err(|_| "не удалось связаться с Telegram".to_string())?;

    let body = response.text().await.map_err(|_| {
        // ответ getMe крошечный; усечение — защита от неожиданно большого тела
        "не удалось прочитать ответ Telegram".to_string()
    })?;
    let body = if body.len() > MAX_GET_ME_BYTES {
        &body[..MAX_GET_ME_BYTES]
    } else {
        &body[..]
    };

    parse_get_me(body)
}

#[cfg(test)]
mod tests {
    use super::{is_plausible_token, parse_get_me, BotIdentity};

    #[test]
    fn parse_get_me_reads_bot_identity() {
        let body = r#"{"ok":true,"result":{"id":12345,"is_bot":true,"username":"oura_sales_bot"}}"#;
        assert_eq!(
            parse_get_me(body).unwrap(),
            BotIdentity {
                username: "oura_sales_bot".to_string(),
                bot_id: 12345,
            }
        );
    }

    #[test]
    fn parse_get_me_maps_unauthorized_to_plain_message() {
        let body = r#"{"ok":false,"error_code":401,"description":"Unauthorized"}"#;
        assert_eq!(parse_get_me(body).unwrap_err(), "токен отклонён Telegram");
    }

    #[test]
    fn parse_get_me_rejects_bot_without_username() {
        let body = r#"{"ok":true,"result":{"id":7,"is_bot":true}}"#;
        assert!(parse_get_me(body).unwrap_err().contains("username"));
    }

    #[test]
    fn parse_get_me_rejects_garbage_body() {
        assert_eq!(
            parse_get_me("<html>502</html>").unwrap_err(),
            "Telegram вернул неожиданный ответ"
        );
    }

    #[test]
    fn plausible_token_gate_runs_before_any_network_call() {
        assert!(is_plausible_token(
            "123456789:AAF-abcdefghijklmnopqrstuvwxyz01"
        ));
        assert!(!is_plausible_token("нет-двоеточия"));
        assert!(!is_plausible_token("abc:AAF-abcdefghijklmnopqrstuvwxyz01"));
        assert!(!is_plausible_token("123456789:short"));
        assert!(!is_plausible_token(""));
    }
}
