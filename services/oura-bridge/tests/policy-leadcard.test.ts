import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARD_CAPS,
  LeadCardStore,
  applyLeadCardPatch,
  newLeadCard,
} from "../src/policy/leadcard.js";

function tmpCardsPath(): string {
  return join(mkdtempSync(join(tmpdir(), "oura-cards-")), "leadcards.json");
}

const fixedNow = () => 1_722_500_000_000;

const base = {
  chatId: "42",
  name: "Иван",
  source: "telegram",
  leadPubkey: "ab".repeat(32),
  channelId: "chan-1",
};

describe("newLeadCard", () => {
  it("создаёт карточку со статусом new и капит поля", () => {
    const card = newLeadCard({ ...base, name: "и".repeat(500) }, fixedNow);
    expect(card.status).toBe("new");
    expect(card.name).toHaveLength(CARD_CAPS.name);
    expect(card.updatedAt).toBe(fixedNow());
  });
});

describe("applyLeadCardPatch — чистый мерж с капами (Р12)", () => {
  it("мержит поля заказа и обновляет updatedAt", () => {
    const card = newLeadCard(base, fixedNow);
    const later = () => fixedNow() + 1000;
    const updated = applyLeadCardPatch(
      card,
      { order: { phone: "+79990001122", summary: "Заказ пиццы" } },
      later,
    );
    expect(updated.order?.phone).toBe("+79990001122");
    expect(updated.order?.summary).toBe("Заказ пиццы");
    expect(updated.updatedAt).toBe(later());
    // исходная карточка не мутирована
    expect(card.order).toBeUndefined();
  });

  it("капит длину полей заказа и число products", () => {
    const card = newLeadCard(base, fixedNow);
    const updated = applyLeadCardPatch(
      card,
      {
        order: {
          summary: "х".repeat(1000),
          products: Array.from(
            { length: 50 },
            (_, i) => `товар-${i}-${"y".repeat(200)}`,
          ),
        },
      },
      fixedNow,
    );
    expect(updated.order?.summary).toHaveLength(CARD_CAPS.summary);
    expect(updated.order?.products).toHaveLength(CARD_CAPS.productsCount);
    for (const p of updated.order?.products ?? []) {
      expect(p.length).toBeLessThanOrEqual(CARD_CAPS.productItem);
    }
  });

  it("статусы ограничены известным набором", () => {
    const card = newLeadCard(base, fixedNow);
    expect(
      applyLeadCardPatch(card, { status: "waiting_human" }, fixedNow).status,
    ).toBe("waiting_human");
    expect(() =>
      applyLeadCardPatch(card, { status: "superstatus" as never }, fixedNow),
    ).toThrow(/статус/);
  });

  it("частичный патч заказа не затирает уже собранные поля", () => {
    const card = newLeadCard(base, fixedNow);
    const withPhone = applyLeadCardPatch(
      card,
      { order: { phone: "+79990001122" } },
      fixedNow,
    );
    const withCity = applyLeadCardPatch(
      withPhone,
      { order: { city: "Москва" } },
      fixedNow,
    );
    expect(withCity.order?.phone).toBe("+79990001122");
    expect(withCity.order?.city).toBe("Москва");
  });
});

describe("LeadCardStore — персистенс", () => {
  it("upsert создаёт, get возвращает, повторный upsert не пересоздаёт", async () => {
    const store = await LeadCardStore.load(tmpCardsPath(), fixedNow);
    const created = await store.upsert(base);
    const again = await store.upsert({ ...base, name: "Другое имя" });
    expect(again.name).toBe(created.name); // существующая карточка не перезатирается
    expect(store.get("42")?.status).toBe("new");
  });

  it("update патчит существующую карточку и падает на незнакомом chatId", async () => {
    const store = await LeadCardStore.load(tmpCardsPath(), fixedNow);
    await store.upsert(base);
    await store.update("42", { status: "active" });
    expect(store.get("42")?.status).toBe("active");
    await expect(
      store.update("нет-такого", { status: "active" }),
    ).rejects.toThrow(/chatId/);
  });

  it("roundtrip: новый инстанс читает сохранённые карточки", async () => {
    const path = tmpCardsPath();
    const store = await LeadCardStore.load(path, fixedNow);
    await store.upsert(base);
    await store.update("42", { order: { summary: "Бронь столика" } });

    const reopened = await LeadCardStore.load(path, fixedNow);
    expect(reopened.get("42")?.order?.summary).toBe("Бронь столика");
    expect(reopened.all()).toHaveLength(1);
  });
});
