import { isMacPlatform } from "@/shared/lib/platform";

export type ShortcutCategory =
  | "Навигация"
  | "Сообщения"
  | "Форматирование"
  | "Масштаб";

export type KeyboardShortcut = {
  id: string;
  label: string;
  description: string;
  keys: string;
  keysWindows: string;
  category: ShortcutCategory;
};

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  // Navigation
  {
    id: "quick-search",
    label: "Быстрый поиск",
    description: "Открыть окно поиска",
    keys: "⌘K",
    keysWindows: "Ctrl+K",
    category: "Навигация",
  },
  {
    id: "browse-channels",
    label: "Обзор каналов",
    description: "Открыть список каналов",
    keys: "⇧⌘O",
    keysWindows: "Shift+Ctrl+O",
    category: "Навигация",
  },
  {
    id: "browse-dms",
    label: "Новое личное сообщение",
    description: "Открыть окно нового сообщения",
    keys: "⇧⌘K",
    keysWindows: "Shift+Ctrl+K",
    category: "Навигация",
  },
  {
    id: "new-channel",
    label: "Новый канал",
    description: "Открыть окно создания канала",
    keys: "⇧⌘N",
    keysWindows: "Shift+Ctrl+N",
    category: "Навигация",
  },
  {
    id: "open-settings",
    label: "Настройки",
    description: "Открыть или закрыть настройки",
    keys: "⌘,",
    keysWindows: "Ctrl+,",
    category: "Навигация",
  },
  {
    id: "go-back",
    label: "Назад",
    description: "Перейти на предыдущую страницу",
    keys: "⌘[",
    keysWindows: "Alt+←",
    category: "Навигация",
  },
  {
    id: "go-forward",
    label: "Вперёд",
    description: "Перейти на следующую страницу",
    keys: "⌘]",
    keysWindows: "Alt+→",
    category: "Навигация",
  },
  {
    id: "find-in-channel",
    label: "Поиск в канале",
    description: "Искать сообщения в текущем канале",
    keys: "⌘F",
    keysWindows: "Ctrl+F",
    category: "Навигация",
  },
  {
    id: "go-home",
    label: "Главная",
    description: "Перейти к главной ленте",
    keys: "⇧⌘A",
    keysWindows: "Shift+Ctrl+A",
    category: "Навигация",
  },
  {
    id: "toggle-sidebar",
    label: "Боковая панель",
    description: "Показать или скрыть боковую панель",
    keys: "⌘S",
    keysWindows: "Ctrl+S",
    category: "Навигация",
  },
  {
    id: "mark-current-read",
    label: "Отметить прочитанным",
    description: "Отметить текущий диалог прочитанным",
    keys: "Escape",
    keysWindows: "Escape",
    category: "Навигация",
  },
  {
    id: "mark-all-read",
    label: "Отметить всё прочитанным",
    description: "Отметить все диалоги прочитанными",
    keys: "⇧Escape",
    keysWindows: "Shift+Escape",
    category: "Навигация",
  },

  // Zoom
  {
    id: "zoom-in",
    label: "Увеличить масштаб",
    description: "Увеличить масштаб интерфейса",
    keys: "⌘+",
    keysWindows: "Ctrl+=",
    category: "Масштаб",
  },
  {
    id: "zoom-out",
    label: "Уменьшить масштаб",
    description: "Уменьшить масштаб интерфейса",
    keys: "⌘-",
    keysWindows: "Ctrl+-",
    category: "Масштаб",
  },
  {
    id: "zoom-reset",
    label: "Сбросить масштаб",
    description: "Вернуть масштаб по умолчанию",
    keys: "⌘0",
    keysWindows: "Ctrl+0",
    category: "Масштаб",
  },

  // Messages
  {
    id: "send-message",
    label: "Отправить сообщение",
    description: "Отправить набранное сообщение",
    keys: "Enter",
    keysWindows: "Enter",
    category: "Сообщения",
  },
  {
    id: "new-line",
    label: "Новая строка",
    description: "Вставить перенос строки в поле ввода",
    keys: "Shift+Enter",
    keysWindows: "Shift+Enter",
    category: "Сообщения",
  },
  {
    id: "publish-note",
    label: "Опубликовать заметку",
    description: "Опубликовать заметку в Pulse",
    keys: "⌘Enter",
    keysWindows: "Ctrl+Enter",
    category: "Сообщения",
  },
  {
    id: "close-dialog",
    label: "Закрыть диалог",
    description: "Закрыть текущий диалог или настройки",
    keys: "Escape",
    keysWindows: "Escape",
    category: "Сообщения",
  },
  {
    id: "push-to-talk",
    label: "Нажми и говори",
    description: "Удерживайте, чтобы включить микрофон в хадле",
    keys: "Ctrl+Space",
    keysWindows: "Ctrl+Space",
    category: "Сообщения",
  },

  // Formatting
  {
    id: "format-bold",
    label: "Полужирный",
    description: "Включить или выключить полужирное начертание",
    keys: "⌘B",
    keysWindows: "Ctrl+B",
    category: "Форматирование",
  },
  {
    id: "format-italic",
    label: "Курсив",
    description: "Включить или выключить курсив",
    keys: "⌘I",
    keysWindows: "Ctrl+I",
    category: "Форматирование",
  },
  {
    id: "format-strikethrough",
    label: "Зачёркнутый",
    description: "Включить или выключить зачёркивание",
    keys: "⌘⇧X",
    keysWindows: "Ctrl+Shift+X",
    category: "Форматирование",
  },
  {
    id: "format-code",
    label: "Встроенный код",
    description: "Включить или выключить форматирование кода",
    keys: "⌘E",
    keysWindows: "Ctrl+E",
    category: "Форматирование",
  },
  {
    id: "format-link",
    label: "Вставить ссылку",
    description:
      "Сделать выделенный текст ссылкой или изменить ссылку под курсором",
    keys: "⌘K",
    keysWindows: "Ctrl+K",
    category: "Форматирование",
  },
];

const CATEGORY_ORDER: ShortcutCategory[] = [
  "Навигация",
  "Сообщения",
  "Форматирование",
  "Масштаб",
];

export function getShortcutsByCategory(): Map<
  ShortcutCategory,
  KeyboardShortcut[]
> {
  const map = new Map<ShortcutCategory, KeyboardShortcut[]>();
  for (const cat of CATEGORY_ORDER) {
    map.set(
      cat,
      KEYBOARD_SHORTCUTS.filter((s) => s.category === cat),
    );
  }
  return map;
}

export function getPlatformKeys(shortcut: KeyboardShortcut): string {
  return isMacPlatform() ? shortcut.keys : shortcut.keysWindows;
}

/**
 * Platform-appropriate key hint for a shortcut in {@link KEYBOARD_SHORTCUTS},
 * or null when the id is unknown. Use this for inline hints (menus, tooltips)
 * so they stay in sync with the canonical shortcut registry.
 */
export function getPlatformKeysById(id: string): string | null {
  const shortcut = KEYBOARD_SHORTCUTS.find((s) => s.id === id);
  return shortcut ? getPlatformKeys(shortcut) : null;
}
