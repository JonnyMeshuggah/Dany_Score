import { describe, it, expect } from "vitest";
import { isoToRuDate, parseRuDate, compareNewestFirst } from "../../src/domain/dates.js";
import { computeGradeStats } from "../../src/domain/stats.js";

describe("даты", () => {
  it("ISO → ДД.ММ.ГГГГ", () => expect(isoToRuDate("2026-10-07")).toBe("07.10.2026"));

  it("ДД.ММ.ГГГГ → локальная дата; мусор → null", () => {
    expect(parseRuDate("07.10.2026")).toEqual(new Date(2026, 9, 7));
    expect(parseRuDate("вчера")).toBeNull();
  });

  it("новые сверху, внутри дня — по id", () => {
    const list = [
      { id: "1", date: "16.10.2026" },
      { id: "2", date: "17.10.2026" },
      { id: "3", date: "17.10.2026" }
    ];
    expect([...list].sort(compareNewestFirst).map(e => e.id)).toEqual(["3", "2", "1"]);
  });
});

describe("статистика оценок", () => {
  it("считает только оценки 2–5, среднее строкой с двумя знаками", () => {
    const r = computeGradeStats([{ grade: 5 }, { grade: 4 }, { grade: 4 }, { grade: "—" }]);
    expect(r).toEqual({ stats: { 2: 0, 3: 0, 4: 2, 5: 1 }, average: "4.33", maxCount: 2, totalGrades: 3 });
  });

  it("без оценок среднее 0", () => {
    expect(computeGradeStats([]).average).toBe(0);
  });
});
