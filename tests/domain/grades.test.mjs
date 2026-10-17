import { describe, it, expect } from "vitest";
import { applyGrade } from "../../src/domain/grades.js";

const D = "17.10.2026";
const NOW = new Date(2026, 9, 17, 12);
const bp = (tasks) => ({ xp: 0, level: 0, xpPerLevel: 200, maxLevel: 10, completedTasks: [], claimedRewards: [], tasks });

describe("добавление оценки", () => {
  it("считает награду и ставит запись первой", () => {
    const old = [{ id: "1", date: D, subject: "Алгебра", grade: 5, reward: 250, bonus: "" }];
    const r = applyGrade(old, bp([]), { id: "2", date: D, subject: "Алгебра", grade: 5 }, NOW);
    expect(r.entry).toMatchObject({ reward: 625, bonus: "Бонус 2.5 за 2 подряд по предмету" });
    expect(r.history.map(e => e.id)).toEqual(["2", "1"]);
  });
});

describe("задание на средний балл (баг: среднее без новой оценки)", () => {
  const avg = { id: "a", type: "average_score", target: 4.5, xp: 150 };
  const old = ["1", "2", "3"].map((id, i) => ({ id, date: D, subject: "Физика", grade: [5, 4, 4][i], reward: 0, bonus: "" }));

  it("пятёрка, поднявшая среднее до 4.5, закрывает задание", () => {
    const r = applyGrade(old, bp([avg]), { id: "4", date: D, subject: "История", grade: 5 }, NOW);
    expect(r.tasks.map(t => t.id)).toEqual(["a"]);
  });

  it("оценка, опустившая среднее ниже цели, задание не закрывает", () => {
    const high = old.map(e => ({ ...e, grade: 5 }));
    const r = applyGrade(high, bp([avg]), { id: "4", date: D, subject: "История", grade: 2 }, NOW);
    expect(r.tasks).toEqual([]);
  });
});
