import { describe, it, expect } from "vitest";
import { QUOTES, pickQuoteIndex } from "../../src/domain/quotes.js";

describe("QUOTES", () => {
  it("ровно 500 цитат с текстом и автором", () => {
    expect(QUOTES).toHaveLength(500);
    for (const q of QUOTES) {
      expect(q.text.trim()).not.toBe("");
      expect(q.author.trim()).not.toBe("");
    }
  });

  it("цитаты не повторяются", () => {
    expect(new Set(QUOTES.map(q => q.text)).size).toBe(QUOTES.length);
  });
});

describe("pickQuoteIndex", () => {
  it("никогда не повторяет предыдущую цитату", () => {
    for (const r of [0, 0.25, 0.5, 0.999]) {
      for (const prev of [0, 3, 9]) {
        const i = pickQuoteIndex(10, prev, () => r);
        expect(i).not.toBe(prev);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(10);
      }
    }
  });

  it("без предыдущей (или с битой) берёт любой индекс в диапазоне", () => {
    expect(pickQuoteIndex(10, null, () => 0)).toBe(0);
    expect(pickQuoteIndex(10, NaN, () => 0.999)).toBe(9);
    expect(pickQuoteIndex(10, 42, () => 0.999)).toBe(9);
  });

  it("одна цитата — индекс 0", () => {
    expect(pickQuoteIndex(1, 0, () => 0.7)).toBe(0);
  });
});
