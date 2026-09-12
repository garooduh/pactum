import Decimal from "decimal.js";
export function lineAmount(quantity: string, price: string): Decimal | null {
  const normalize = (s: string) =>
    s.replace(/[\s\u00a0]/g, "").replace(",", ".");
  const q = normalize(quantity),
    p = normalize(price);
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(q) || !/^\d{1,12}(\.\d{1,2})?$/.test(p))
    return null;
  const qty = new Decimal(q);
  if (qty.lte(0)) return null;
  return qty.mul(p).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
export function formatMoney(amount: Decimal | null) {
  if (!amount) return "—";
  return (
    amount
      .toFixed(2)
      .replace(".", ",")
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽"
  );
}
export function totalAmount(items: { quantity: string; price: string }[]) {
  let sum = new Decimal(0);
  for (const item of items) {
    const line = lineAmount(item.quantity, item.price);
    if (line === null) return null;
    sum = sum.add(line);
  }
  return sum;
}
