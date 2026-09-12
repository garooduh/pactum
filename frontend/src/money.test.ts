import { describe, it, expect } from "vitest";
import { lineAmount, totalAmount, formatMoney } from "./money";
describe("Точные расчёты", () => {
  it("округляет каждую строку до копейки", () => {
    expect(
      totalAmount([
        { quantity: "0,5", price: "0,01" },
        { quantity: "0.5", price: "0.01" },
      ])?.toFixed(2),
    ).toBe("0.02");
  });
  it("считает дробные количества", () => {
    expect(lineAmount("2,5", "1234,57")?.toFixed(2)).toBe("3086.43");
  });
  it("отклоняет пустые и недопустимые значения", () => {
    for (const q of ["", "NaN", "Infinity", "-1", "0", "1e5", "1.0001"])
      expect(lineAmount(q, "10")).toBeNull();
    expect(lineAmount("1", "1.001")).toBeNull();
  });
  it("не скрывает незаполненную позицию в итоге", () => {
    expect(
      totalAmount([
        { quantity: "1", price: "10" },
        { quantity: "1", price: "" },
      ]),
    ).toBeNull();
  });
  it("форматирует рубли", () => {
    expect(formatMoney(lineAmount("1", "1234.50"))).toBe("1 234,50 ₽");
  });
});
