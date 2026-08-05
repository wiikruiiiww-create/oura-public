import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { relayClient } from "@/shared/api/relayClient";
import {
  KIND_DELETION,
  KIND_MANAGED_AGENT,
  KIND_PERSONA,
  KIND_TEAM,
} from "@/shared/constants/kinds";
import {
  shouldReconcilePersonaEvent,
  startPersonaSync,
} from "./usePersonaSync.ts";

const EXPECTED_KINDS = [
  KIND_PERSONA,
  KIND_TEAM,
  KIND_MANAGED_AGENT,
  KIND_DELETION,
];

// Regression guard for the fresh-start backfill gap (F3): a device that comes
// online AFTER another published gets zero history from a live-only `limit: 0`
// subscription, because reconnect-replay's since-cursor is undefined until the
// first live event. `startPersonaSync` MUST do a one-shot history fetch up
// front, and both the backfill and the live sub MUST carry the deletion kind
// so tombstones catch up too.
test("startPersonaSync backfills history including the deletion kind", () => {
  const fetchCalls = [];
  const liveCalls = [];
  mock.method(relayClient, "fetchEvents", (filter) => {
    fetchCalls.push(filter);
    return Promise.resolve([]);
  });
  mock.method(relayClient, "subscribeLive", (filter) => {
    liveCalls.push(filter);
    return Promise.resolve(() => Promise.resolve());
  });

  startPersonaSync("owner-pubkey", () => false);

  assert.equal(fetchCalls.length, 1, "must do exactly one backfill fetch");
  assert.deepEqual(
    fetchCalls[0].kinds,
    EXPECTED_KINDS,
    "backfill must cover persona/team/agent + deletion",
  );
  assert.ok(
    fetchCalls[0].limit > 0,
    "backfill must request a positive limit — limit:0 returns no history",
  );
  assert.deepEqual(fetchCalls[0].authors, ["owner-pubkey"]);

  assert.equal(liveCalls.length, 1);
  assert.deepEqual(
    liveCalls[0].kinds,
    EXPECTED_KINDS,
    "live sub must also carry the deletion kind",
  );

  mock.reset();
});

// Внешние агенты живут в том же kind 30177, но локального процесса не имеют —
// реконсиляция затащила бы их в реестр агентов, запускаемых на этом устройстве.
test("описания внешних агентов не попадают в локальный реестр", () => {
  const base = {
    pubkey: "owner-pubkey",
    kind: KIND_MANAGED_AGENT,
    created_at: 10,
    content: JSON.stringify({ name: "Агент" }),
    sig: "",
  };
  const external = {
    ...base,
    id: "external-1",
    tags: [
      ["d", "agent-1"],
      ["agent-type", "external"],
      ["source", "telegram"],
      ["bot-token-enc", "enc", "c".repeat(64)],
    ],
  };
  const internal = {
    ...base,
    id: "internal-1",
    tags: [["d", "b".repeat(64)]],
  };

  assert.equal(shouldReconcilePersonaEvent(internal, "owner-pubkey"), true);
  assert.equal(shouldReconcilePersonaEvent(external, "owner-pubkey"), false);
  assert.equal(
    shouldReconcilePersonaEvent(
      { ...internal, pubkey: "someone-else" },
      "owner-pubkey",
    ),
    false,
    "чужие события по-прежнему игнорируются",
  );
});
