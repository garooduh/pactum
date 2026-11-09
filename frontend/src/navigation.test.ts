import { afterEach, expect, it, vi } from "vitest";
import { readNavigation, writeNavigation } from "./navigation";
afterEach(() => vi.unstubAllGlobals());
it("defaults to contracts when storage is unavailable", () => {
  vi.stubGlobal("sessionStorage", { getItem() { throw Error(); } });
  expect(readNavigation()).toEqual({ view: "history" });
  expect(() => writeNavigation({ view: "history" })).not.toThrow();
});
it("rejects obsolete pages and malformed editor state", () => {
  for (const value of ['{"view":"home"}', '{"view":"editor"}', 'invalid']) {
    vi.stubGlobal("sessionStorage", { getItem: () => value });
    expect(readNavigation()).toEqual({ view: "history" });
  }
});
it("restores an editor and validates its step", () => {
  vi.stubGlobal("sessionStorage", { getItem: () => JSON.stringify({ view: "editor", contractId: "abc", step: 3 }) });
  expect(readNavigation()).toMatchObject({ view: "editor", contractId: "abc", step: 3 });
});
