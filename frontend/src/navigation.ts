export interface Navigation {
  view: "history" | "profile" | "furniture" | "editor";
  contractId?: string;
  step?: number;
  furnitureId?: string;
}
const key = "pact.navigation";
export function readNavigation(): Navigation {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!value || !["history", "profile", "furniture", "editor"].includes(value.view))
      return { view: "history" };
    if (value.view === "editor" && typeof value.contractId !== "string")
      return { view: "history" };
    return {
      view: value.view,
      contractId: typeof value.contractId === "string" ? value.contractId : undefined,
      furnitureId: typeof value.furnitureId === "string" ? value.furnitureId : undefined,
      step: Number.isInteger(value.step) && value.step >= 0 && value.step <= 3 ? value.step : 0,
    };
  } catch { return { view: "history" }; }
}
export function writeNavigation(value: Navigation) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be disabled. */ }
}
