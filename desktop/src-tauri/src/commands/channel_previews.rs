use std::collections::{HashMap, HashSet};

use serde::Serialize;
use tauri::State;

use crate::{app_state::AppState, relay::query_relay};

/// Максимум комнат в одном батче: весь список едет в `#h` одного фильтра.
const MAX_PREVIEW_CHANNELS: usize = 200;

/// Верхняя граница выборки сообщений на весь батч. Компромисс v1: если во
/// всех комнатах лидов суммарно больше свежих сообщений, самые тихие комнаты
/// не попадут в выборку и останутся без превью. Per-channel-альтернатива
/// (`get_channel_window`) невозможна батчем — relay требует ровно один `#h`.
const PREVIEW_QUERY_LIMIT: u32 = 500;

/// Последнее сообщение комнаты + сколько различных авторов в ней встретилось.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChannelPreviewInfo {
    pub channel_id: String,
    pub event_id: String,
    pub pubkey: String,
    pub content: String,
    pub created_at: u64,
    /// Число различных авторов kind:9 в выборке. Ровно один автор = в комнате
    /// говорил только лид, ей ещё никто не ответил — фронт рисует «новый».
    pub author_count: u32,
}

#[derive(Debug, Clone)]
struct PreviewRow {
    channel_id: String,
    event_id: String,
    pubkey: String,
    content: String,
    created_at: u64,
}

/// Сворачивает плоский список сообщений в «самое новое на комнату» плюс число
/// различных авторов. Вся логика команды живёт здесь, чтобы её можно было
/// покрыть тестами без relay.
fn fold_previews(rows: Vec<PreviewRow>) -> Vec<ChannelPreviewInfo> {
    let mut latest: HashMap<String, PreviewRow> = HashMap::new();
    let mut authors: HashMap<String, HashSet<String>> = HashMap::new();

    for row in rows {
        authors
            .entry(row.channel_id.clone())
            .or_default()
            .insert(row.pubkey.clone());

        // Ничью по created_at разрешаем по event_id: без этого порядок выдачи
        // relay делал бы превью недетерминированным между обновлениями.
        let replace = match latest.get(&row.channel_id) {
            Some(current) => {
                (row.created_at, row.event_id.as_str())
                    > (current.created_at, current.event_id.as_str())
            }
            None => true,
        };
        if replace {
            latest.insert(row.channel_id.clone(), row);
        }
    }

    let mut previews: Vec<ChannelPreviewInfo> = latest
        .into_values()
        .map(|row| {
            let author_count = authors.get(&row.channel_id).map_or(0, HashSet::len) as u32;
            ChannelPreviewInfo {
                channel_id: row.channel_id,
                event_id: row.event_id,
                pubkey: row.pubkey,
                content: row.content,
                created_at: row.created_at,
                author_count,
            }
        })
        .collect();
    previews.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| left.channel_id.cmp(&right.channel_id))
    });
    previews
}

fn channel_id_from_event(event: &nostr::Event) -> Option<String> {
    event.tags.iter().find_map(|tag| {
        let slice = tag.as_slice();
        if slice.len() >= 2 && slice[0] == "h" {
            Some(slice[1].clone())
        } else {
            None
        }
    })
}

/// Батч-превью последнего сообщения по списку комнат — источник данных для
/// экрана «Обращения». Один поход в `/query` на весь экран.
#[tauri::command]
pub async fn get_channel_previews(
    channel_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ChannelPreviewInfo>, String> {
    let ids: Vec<String> = channel_ids.into_iter().take(MAX_PREVIEW_CHANNELS).collect();
    // Пустой `#h` в фильтре вернул бы сообщения всей community — на пустом
    // экране «Обращений» это лишний и вредный запрос.
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let wanted: HashSet<String> = ids.iter().cloned().collect();
    let filter = serde_json::json!({
        "kinds": [9],
        "#h": ids,
        "limit": PREVIEW_QUERY_LIMIT,
    });

    let events = query_relay(&state, &[filter]).await?;
    let rows = events
        .iter()
        .filter_map(|event| {
            let channel_id = channel_id_from_event(event)?;
            if !wanted.contains(&channel_id) {
                return None;
            }
            Some(PreviewRow {
                channel_id,
                event_id: event.id.to_hex(),
                pubkey: event.pubkey.to_hex(),
                content: event.content.clone(),
                created_at: event.created_at.as_secs(),
            })
        })
        .collect();

    Ok(fold_previews(rows))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(channel_id: &str, event_id: &str, pubkey: &str, created_at: u64) -> PreviewRow {
        PreviewRow {
            channel_id: channel_id.to_string(),
            event_id: event_id.to_string(),
            pubkey: pubkey.to_string(),
            content: format!("текст {event_id}"),
            created_at,
        }
    }

    #[test]
    fn empty_input_yields_empty_output() {
        assert!(fold_previews(Vec::new()).is_empty());
    }

    #[test]
    fn keeps_only_the_newest_event_per_channel() {
        let previews = fold_previews(vec![
            row("a", "e1", "lead", 100),
            row("a", "e3", "lead", 300),
            row("a", "e2", "lead", 200),
            row("b", "e4", "lead", 50),
        ]);
        assert_eq!(previews.len(), 2);
        assert_eq!(previews[0].channel_id, "a");
        assert_eq!(previews[0].event_id, "e3");
        assert_eq!(previews[0].content, "текст e3");
        assert_eq!(previews[1].channel_id, "b");
    }

    #[test]
    fn ties_on_created_at_resolve_deterministically_by_event_id() {
        let previews = fold_previews(vec![
            row("a", "e1", "lead", 100),
            row("a", "e2", "lead", 100),
        ]);
        assert_eq!(previews[0].event_id, "e2");
    }

    #[test]
    fn counts_distinct_authors_per_channel() {
        let previews = fold_previews(vec![
            row("a", "e1", "lead", 100),
            row("a", "e2", "lead", 110),
            row("b", "e3", "lead", 120),
            row("b", "e4", "operator", 130),
        ]);
        let by_channel: HashMap<&str, u32> = previews
            .iter()
            .map(|preview| (preview.channel_id.as_str(), preview.author_count))
            .collect();
        assert_eq!(by_channel["a"], 1);
        assert_eq!(by_channel["b"], 2);
    }

    #[test]
    fn output_is_sorted_newest_first() {
        let previews = fold_previews(vec![
            row("a", "e1", "lead", 100),
            row("b", "e2", "lead", 300),
            row("c", "e3", "lead", 200),
        ]);
        let order: Vec<&str> = previews
            .iter()
            .map(|preview| preview.channel_id.as_str())
            .collect();
        assert_eq!(order, vec!["b", "c", "a"]);
    }
}
