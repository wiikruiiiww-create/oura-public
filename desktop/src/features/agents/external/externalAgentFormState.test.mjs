import assert from "node:assert/strict";
import test from "node:test";

import {
  canSubmitExternalAgent,
  emptyExternalAgentForm,
  externalAgentDraftFromForm,
  tokenCheckReducer,
} from "./externalAgentFormState.ts";

const BRIDGE = "c".repeat(64);

const VERIFIED_TOKEN = "123456789:AAF-abcdefghijklmnopqrstuvwxyz01";

function readyForm() {
  return {
    ...emptyExternalAgentForm(),
    name: "Продавец",
    goal: "Записать на консультацию",
    token: VERIFIED_TOKEN,
    tokenCheck: {
      status: "ok",
      username: "oura_sales_bot",
      botId: 42,
      token: VERIFIED_TOKEN,
    },
  };
}

test("пустая форма не сабмитится: нужна цель", () => {
  const result = canSubmitExternalAgent(emptyExternalAgentForm(), BRIDGE);
  assert.equal(result.ok, false);
  assert.match(result.reason, /цель/i);
});

test("без проверенного токена сабмит заблокирован", () => {
  const form = { ...readyForm(), tokenCheck: { status: "idle" } };
  const result = canSubmitExternalAgent(form, BRIDGE);
  assert.equal(result.ok, false);
  assert.match(result.reason, /токен/i);
});

test("изменённый после проверки токен снова блокирует сабмит", () => {
  const form = { ...readyForm(), token: "999:другой-токен-после-проверки-01" };
  const result = canSubmitExternalAgent(form, BRIDGE);
  assert.equal(result.ok, false);
  assert.match(result.reason, /токен/i);
});

test("без сервиса лидов в сообществе сабмит заблокирован", () => {
  const result = canSubmitExternalAgent(readyForm(), null);
  assert.equal(result.ok, false);
  assert.match(result.reason, /сервис лидов/i);
});

test("заполненная форма с проверенным токеном и сервисом сабмитится", () => {
  assert.deepEqual(canSubmitExternalAgent(readyForm(), BRIDGE), { ok: true });
});

test("черновик агента собирается из формы: профиль и активность", () => {
  const draft = externalAgentDraftFromForm(readyForm(), {
    agentId: "agent-1",
    botTokenEnc: "шифртекст",
    bridgePubkey: BRIDGE,
  });

  assert.equal(draft.agentId, "agent-1");
  assert.equal(draft.name, "Продавец");
  assert.equal(draft.isActive, true);
  assert.equal(draft.botTokenEnc, "шифртекст");
  assert.equal(draft.bridgePubkey, BRIDGE);
  assert.equal(draft.profile.goal, "Записать на консультацию");
  assert.equal(draft.profile.role, "sales");
  assert.equal(draft.profile.tone.formality, "friendly");
});

test("имя по умолчанию берётся из цели, если пользователь его не ввёл", () => {
  const draft = externalAgentDraftFromForm(
    { ...readyForm(), name: "   " },
    { agentId: "a", botTokenEnc: "e", bridgePubkey: BRIDGE },
  );
  assert.equal(draft.name, "Записать на консультацию");
});

test("длинная цель обрезается в имени до читаемой длины", () => {
  const goal = "Записать клиента на бесплатную диагностическую консультацию";
  const draft = externalAgentDraftFromForm(
    { ...readyForm(), name: "", goal },
    { agentId: "a", botTokenEnc: "e", bridgePubkey: BRIDGE },
  );
  assert.ok(draft.name.length <= 40, `имя слишком длинное: ${draft.name}`);
  assert.ok(goal.startsWith(draft.name.replace(/…$/, "")));
});

test("проверка токена: цикл состояний idle → checking → ok", () => {
  let state = tokenCheckReducer({ status: "idle" }, { type: "check-started" });
  assert.equal(state.status, "checking");

  state = tokenCheckReducer(state, {
    type: "check-succeeded",
    username: "bot",
    botId: 1,
    token: "123456789:AAF-abcdefghijklmnopqrstuvwxyz01",
  });
  assert.equal(state.status, "ok");
  assert.equal(state.username, "bot");
});

test("ошибка проверки токена сохраняет причину для показа в форме", () => {
  const state = tokenCheckReducer(
    { status: "checking" },
    { type: "check-failed", error: "токен отклонён Telegram" },
  );
  assert.equal(state.status, "error");
  assert.equal(state.error, "токен отклонён Telegram");
});

test("правка токена сбрасывает результат прошлой проверки", () => {
  const checked = {
    status: "ok",
    username: "bot",
    botId: 1,
    token: "старый",
  };
  const state = tokenCheckReducer(checked, { type: "token-edited" });
  assert.equal(state.status, "idle");
});
