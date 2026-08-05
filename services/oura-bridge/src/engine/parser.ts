/**
 * Разбор ответа модели: служебные теги вырезаются из текста (клиент их видеть
 * не должен) и превращаются в структуру, по которой мост решает, что делать
 * дальше — передать диалог человеку, отметить достижение цели, сохранить
 * контакты.
 *
 * Разбор устойчив к самодеятельности модели: незнакомые теги удаляются,
 * незнакомые значения статуса и этапа игнорируются, а одинокая скобка в тексте
 * («цена [от 1000») остаётся у клиента как есть.
 */

export type ReplyStatus =
  | "in_progress"
  | "order_confirmed"
  | "rejected"
  | "question_only";

export type ReplyStep =
  | "greeting"
  | "need_identification"
  | "product_consultation"
  | "closing"
  | "collecting_contacts"
  | "order_placed"
  | "goal_completed";

export interface ReplyFields {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  date?: string;
  time?: string;
  products?: string;
  rejection?: string;
}

export interface ParsedReply {
  /** текст, который увидит клиент */
  text: string;
  status: ReplyStatus | null;
  step: ReplyStep | null;
  summary: string | null;
  needsHuman: boolean;
  fields: ReplyFields;
}

const STATUSES: ReplyStatus[] = [
  "in_progress",
  "order_confirmed",
  "rejected",
  "question_only",
];

const STEPS: ReplyStep[] = [
  "greeting",
  "need_identification",
  "product_consultation",
  "closing",
  "collecting_contacts",
  "order_placed",
  "goal_completed",
];

const FIELD_TAGS: Record<string, keyof ReplyFields> = {
  NAME: "name",
  PHONE: "phone",
  ADDRESS: "address",
  CITY: "city",
  DATE: "date",
  TIME: "time",
  PRODUCTS: "products",
  REJECTION: "rejection",
};

/** `[TAG:значение]` — значение не содержит скобок, поэтому текст с одинокой `[` не съедается. */
const TAG_WITH_VALUE = /\[([A-Z_]+):([^\][]*)\]/g;
const NEED_HUMAN_TAG = /\[NEED_HUMAN\]/g;

export function parseAgentReply(raw: string): ParsedReply {
  const parsed: ParsedReply = {
    text: "",
    status: null,
    step: null,
    summary: null,
    needsHuman: NEED_HUMAN_TAG.test(raw),
    fields: {},
  };
  NEED_HUMAN_TAG.lastIndex = 0;

  const stripped = raw
    .replace(NEED_HUMAN_TAG, " ")
    .replace(TAG_WITH_VALUE, (_match, rawTag: string, rawValue: string) => {
      const tag = rawTag.toUpperCase();
      const value = rawValue.trim();

      if (tag === "STATUS") {
        if ((STATUSES as string[]).includes(value)) {
          parsed.status = value as ReplyStatus;
        }
      } else if (tag === "STEP") {
        if ((STEPS as string[]).includes(value)) {
          parsed.step = value as ReplyStep;
        }
      } else if (tag === "SUMMARY") {
        if (value) parsed.summary = value;
      } else {
        const field = FIELD_TAGS[tag];
        if (field && value) parsed.fields[field] = value;
      }
      // незнакомые теги просто исчезают из текста
      return " ";
    });

  parsed.text = stripped.replace(/[ \t]+/g, " ").trim();
  return parsed;
}
