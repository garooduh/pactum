import { describe, expect, it } from "vitest";
import { furnitureCreatedAt, matchesFurnitureList } from "./furnitureMetadata";

describe("furniture metadata", () => {
  it("uses Moscow dates across UTC midnight and preserves unknown dates", () => {
    expect(furnitureCreatedAt(null)).toBe("Дата создания неизвестна");
    expect(furnitureCreatedAt("2026-11-08T22:30:00+00:00")).toBe("Создан 09.11.2026");
    expect(furnitureCreatedAt("2026-11-09T00:30:00+00:00")).toBe("Создан 09.11.2026");
  });
  it("finds titles and plain or decorated numbers", () => {
    const list = { number: 12, data: { title: "Клиника" } };
    for (const query of ["клин", "12", "№12", " № 12 "]) {
      expect(matchesFurnitureList(list, query)).toBe(true);
    }
    expect(matchesFurnitureList(list, "№13")).toBe(false);
  });
});
