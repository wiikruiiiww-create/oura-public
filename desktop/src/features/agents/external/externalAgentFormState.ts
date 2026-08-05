import {
  EXTERNAL_AGENT_DEFAULT_PROFILE,
  type ExternalAgentDraft,
  type ExternalAgentFormality,
  type ExternalAgentLength,
  type ExternalAgentRole,
} from "./externalAgent";

/**
 * Pure form logic for creating an external agent, kept out of the dialog so
 * the submit gates and the token-check lifecycle can be tested directly.
 *
 * Two gates exist because both failures are silent otherwise: an unverified
 * bot token only surfaces as "the agent never answers", and a missing lead
 * service key would encrypt the token to nobody.
 */

const NAME_FROM_GOAL_MAX = 40;

export type TokenCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "error"; error: string }
  | {
      status: "ok";
      username: string;
      botId: number;
      /** the exact token that was verified — editing it invalidates the check */
      token: string;
    };

export type TokenCheckAction =
  | { type: "check-started" }
  | { type: "check-failed"; error: string }
  | {
      type: "check-succeeded";
      username: string;
      botId: number;
      token: string;
    }
  | { type: "token-edited" };

export function tokenCheckReducer(
  state: TokenCheckState,
  action: TokenCheckAction,
): TokenCheckState {
  switch (action.type) {
    case "check-started":
      return { status: "checking" };
    case "check-failed":
      return { status: "error", error: action.error };
    case "check-succeeded":
      return {
        status: "ok",
        username: action.username,
        botId: action.botId,
        token: action.token,
      };
    case "token-edited":
      return state.status === "idle" ? state : { status: "idle" };
    default:
      return state;
  }
}

export interface ExternalAgentForm {
  name: string;
  goal: string;
  role: ExternalAgentRole;
  formality: ExternalAgentFormality;
  maxEmojis: number;
  maxLength: ExternalAgentLength;
  language: string;
  audience: string;
  instructions: string;
  knowledge: string;
  token: string;
  tokenCheck: TokenCheckState;
}

export function emptyExternalAgentForm(): ExternalAgentForm {
  const defaults = EXTERNAL_AGENT_DEFAULT_PROFILE;
  return {
    name: "",
    goal: "",
    role: defaults.role,
    formality: defaults.tone.formality,
    maxEmojis: defaults.tone.maxEmojis,
    maxLength: defaults.tone.maxLength,
    language: defaults.tone.language,
    audience: "",
    instructions: "",
    knowledge: "",
    token: "",
    tokenCheck: { status: "idle" },
  };
}

export type ExternalAgentSubmitGate =
  | { ok: true }
  | { ok: false; reason: string };

/** Проверка привязана к конкретному значению: правка токена её аннулирует. */
function isTokenVerified(form: ExternalAgentForm): boolean {
  return (
    form.tokenCheck.status === "ok" &&
    form.tokenCheck.token === form.token.trim()
  );
}

export function canSubmitExternalAgent(
  form: ExternalAgentForm,
  leadServicePubkey: string | null,
): ExternalAgentSubmitGate {
  if (form.goal.trim().length === 0) {
    return { ok: false, reason: "Укажите цель агента" };
  }
  if (!isTokenVerified(form)) {
    return { ok: false, reason: "Проверьте токен бота" };
  }
  if (!leadServicePubkey) {
    return {
      ok: false,
      reason: "В настройках сообщества не задан сервис лидов",
    };
  }
  return { ok: true };
}

export interface ExternalAgentDraftContext {
  agentId: string;
  botTokenEnc: string;
  bridgePubkey: string;
}

/** Имя необязательно: без него агент называется своей целью. */
function resolveName(form: ExternalAgentForm): string {
  const name = form.name.trim();
  if (name.length > 0) return name;
  const goal = form.goal.trim();
  return goal.length > NAME_FROM_GOAL_MAX
    ? `${goal.slice(0, NAME_FROM_GOAL_MAX - 1).trimEnd()}…`
    : goal;
}

export function externalAgentDraftFromForm(
  form: ExternalAgentForm,
  context: ExternalAgentDraftContext,
): ExternalAgentDraft {
  return {
    agentId: context.agentId,
    name: resolveName(form),
    isActive: true,
    botTokenEnc: context.botTokenEnc,
    bridgePubkey: context.bridgePubkey,
    profile: {
      goal: form.goal.trim(),
      role: form.role,
      tone: {
        formality: form.formality,
        maxEmojis: form.maxEmojis,
        maxLength: form.maxLength,
        language: form.language,
      },
      audience: form.audience.trim(),
      instructions: form.instructions.trim(),
      knowledge: form.knowledge.trim(),
    },
  };
}
