import type { Party } from "./types";

export function requisiteLength(key: keyof Party, kind: Party["kind"]): number | undefined {
  switch (key) {
    case "inn": return kind === "ip" ? 12 : 10;
    case "registration": return kind === "ip" ? 15 : 13;
    case "kpp": return kind === "company" ? 9 : undefined;
    case "bik": return 9;
    case "account":
    case "correspondent": return 20;
    default: return undefined;
  }
}

// Keep identifiers as strings: leading zeroes and all 20 account digits matter.
export const normalizeRequisite = (value: string) => value.replace(/\s/g, "");
export function requisiteError(value: string, length: number): string | undefined {
  const clean = normalizeRequisite(value);
  if (!clean) return undefined;
  if (!/^[0-9]+$/.test(clean)) return "Допустимы только цифры от 0 до 9";
  if (clean.length !== length) return `Нужно ${length} цифр, введено ${clean.length}`;
  return undefined;
}
