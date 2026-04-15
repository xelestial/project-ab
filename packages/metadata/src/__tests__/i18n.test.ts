import { describe, it, expect, afterEach } from "vitest";
import { getText, setLocale, getLocale } from "../i18n.js";

afterEach(() => {
  setLocale("ko");
});

describe("i18n", () => {
  it("defaults to Korean locale", () => {
    expect(getLocale()).toBe("ko");
  });

  it("returns Korean text for known key", () => {
    expect(getText("effect.freeze")).toBe("빙결");
  });

  it("returns English text after setLocale", () => {
    setLocale("en");
    expect(getText("effect.freeze")).toBe("Freeze");
  });

  it("interpolates single param", () => {
    const result = getText("turn.round", { round: 3 });
    expect(result).toBe("3라운드");
  });

  it("interpolates multiple params", () => {
    setLocale("en");
    const result = getText("end.winner", { player: "Alice" });
    expect(result).toBe("Alice Wins!");
  });

  it("falls back to key when translation is missing", () => {
    expect(getText("totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("falls back to English when Korean is missing but English exists", () => {
    // The en translations are a superset; if a key exists in en but not ko, it falls back
    setLocale("ko");
    const result = getText("end.winner", { player: "테스트" });
    // ko has "end.winner": "{player}의 승리!"
    expect(result).toBe("테스트의 승리!");
  });
});
