import { describe, expect, it } from "vitest";
import {
  COMPANY_INFO_D_TAG,
  COMPANY_INFO_KIND,
  fetchCompanyInfo,
  parseCompanyInfoEvent,
} from "../src/company/company-info.js";
import type { RelayEvent } from "../src/agents/definition.js";

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";

function event(
  content: string,
  overrides: Partial<RelayEvent> = {},
): RelayEvent {
  return {
    id: "e1",
    pubkey: "0f11".padEnd(64, "0"),
    kind: COMPANY_INFO_KIND,
    created_at: 100,
    tags: [["d", COMPANY_INFO_D_TAG]],
    content,
    ...overrides,
  };
}

describe("разбор события о компании", () => {
  it("читает заполненные поля", () => {
    expect(
      parseCompanyInfoEvent(
        event(
          JSON.stringify({
            name: "Окна плюс",
            description: "производим и ставим окна",
            address: "Москва, Ленина 1",
            workingHours: "пн–пт 9:00–18:00",
            contacts: "+7 999 000-00-00",
          }),
        ),
      ),
    ).toEqual({
      name: "Окна плюс",
      description: "производим и ставим окна",
      address: "Москва, Ленина 1",
      workingHours: "пн–пт 9:00–18:00",
      contacts: "+7 999 000-00-00",
    });
  });

  it("пустые и нестроковые поля отбрасываются", () => {
    expect(
      parseCompanyInfoEvent(
        event(JSON.stringify({ name: "Окна плюс", address: "", contacts: 42 })),
      ),
    ).toEqual({ name: "Окна плюс" });
  });

  it("чужой d-тег не считается описанием компании", () => {
    expect(
      parseCompanyInfoEvent(
        event(JSON.stringify({ name: "Окна" }), {
          tags: [["d", "read-state:1"]],
        }),
      ),
    ).toBeNull();
  });

  it("битый JSON не роняет мост", () => {
    expect(parseCompanyInfoEvent(event("{не json"))).toBeNull();
  });

  it("описание без единого поля — это отсутствие описания", () => {
    expect(parseCompanyInfoEvent(event(JSON.stringify({})))).toBeNull();
  });
});

describe("получение описания с relay", () => {
  it("запрашивает только события компании", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init?.body ?? "null")) });
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;
    await fetchCompanyInfo({
      relayUrl: "http://relay.test",
      serviceNsec: NSEC,
      fetchImpl,
    });
    expect(requests[0].url).toBe("http://relay.test/query");
    expect(requests[0].body).toEqual([
      {
        kinds: [COMPANY_INFO_KIND],
        "#d": [COMPANY_INFO_D_TAG],
        limit: 20,
      },
    ]);
  });

  it("берёт самую свежую редакцию", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify([
          event(JSON.stringify({ name: "Старое" }), {
            id: "old",
            created_at: 100,
          }),
          event(JSON.stringify({ name: "Новое" }), {
            id: "new",
            created_at: 200,
          }),
        ]),
        { status: 200 },
      )) as unknown as typeof fetch;
    const info = await fetchCompanyInfo({
      relayUrl: "http://relay.test",
      serviceNsec: NSEC,
      fetchImpl,
    });
    expect(info?.name).toBe("Новое");
  });

  it("нет описания — не ошибка", async () => {
    const fetchImpl = (async () =>
      new Response("[]", { status: 200 })) as unknown as typeof fetch;
    expect(
      await fetchCompanyInfo({
        relayUrl: "http://relay.test",
        serviceNsec: NSEC,
        fetchImpl,
      }),
    ).toBeNull();
  });

  it("отказ relay поднимается вызывающему", async () => {
    const fetchImpl = (async () =>
      new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(
      fetchCompanyInfo({
        relayUrl: "http://relay.test",
        serviceNsec: NSEC,
        fetchImpl,
      }),
    ).rejects.toThrow(/500/);
  });
});
