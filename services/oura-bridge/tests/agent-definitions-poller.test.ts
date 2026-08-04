import { describe, expect, it } from "vitest";
import { fetchExternalAgentDefs } from "../src/agents/definitions-poller.js";
import { mintIdentity } from "../src/identity.js";
import type { RelayEvent } from "../src/agents/definition.js";

const service = mintIdentity();

function externalEvt(agentId: string, createdAt = 1000): RelayEvent {
  return {
    id: `id-${agentId}-${createdAt}`,
    pubkey: "a".repeat(64),
    kind: 30177,
    created_at: createdAt,
    tags: [
      ["d", agentId],
      ["agent-type", "external"],
      ["source", "telegram"],
      ["bot-token-enc", "шифр", "c".repeat(64)],
    ],
    content: JSON.stringify({ name: agentId, isActive: true }),
  };
}

function internalEvt(): RelayEvent {
  return {
    id: "internal-1",
    pubkey: "b".repeat(64),
    kind: 30177,
    created_at: 500,
    tags: [["d", "local-agent"]],
    content: JSON.stringify({ name: "локальный" }),
  };
}

function fetchReturning(
  events: unknown,
  status = 200,
): { impl: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return new Response(JSON.stringify(events), { status });
  }) as typeof fetch;
  return { impl, calls };
}

describe("fetchExternalAgentDefs", () => {
  it("шлёт NIP-98-подписанный POST /query с фильтром kind 30177", async () => {
    const { impl, calls } = fetchReturning([]);
    await fetchExternalAgentDefs({
      relayUrl: "http://relay.test/",
      serviceNsec: service.nsec,
      fetchImpl: impl,
      nowSec: 1700000000,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://relay.test/query");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^Nostr /);
    const filters = JSON.parse(String(calls[0].init.body));
    expect(filters).toEqual([{ kinds: [30177], limit: 500 }]);
  });

  it("из смеси событий возвращает только валидных внешних агентов (LWW)", async () => {
    const { impl } = fetchReturning([
      internalEvt(),
      externalEvt("agent-1", 1000),
      externalEvt("agent-1", 2000),
      externalEvt("agent-2"),
    ]);
    const defs = await fetchExternalAgentDefs({
      relayUrl: "http://relay.test",
      serviceNsec: service.nsec,
      fetchImpl: impl,
    });
    expect(defs.map((d) => [d.agentId, d.createdAt]).sort()).toEqual([
      ["agent-1", 2000],
      ["agent-2", 1000],
    ]);
  });

  it("HTTP-ошибка relay → throw (вызывающий живёт со старым снапшотом)", async () => {
    const { impl } = fetchReturning({ error: "boom" }, 500);
    await expect(
      fetchExternalAgentDefs({
        relayUrl: "http://relay.test",
        serviceNsec: service.nsec,
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/500/);
  });

  it("не-массив в ответе → throw", async () => {
    const { impl } = fetchReturning({ events: [] });
    await expect(
      fetchExternalAgentDefs({
        relayUrl: "http://relay.test",
        serviceNsec: service.nsec,
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/массив/);
  });
});
