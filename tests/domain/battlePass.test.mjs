import { describe, it, expect } from "vitest";
import { levelFromXP, levelProgress, findCompletedTasks, completeTasks } from "../../src/domain/battlePass.js";

// Правил боевого пропуска в FAQ нет — тесты фиксируют поведение приложения
const bp = (over = {}) => ({
  xp: 0, level: 0, xpPerLevel: 200, maxLevel: 10, completedTasks: [], claimedRewards: [], tasks: [], ...over
});
const NOW = new Date(2026, 9, 17, 12);

describe("уровни", () => {
  it("уровень = floor(xp / xpPerLevel), не выше maxLevel", () => {
    expect(levelFromXP(399, bp())).toBe(1);
    expect(levelFromXP(99999, bp())).toBe(10);
  });

  it("прогресс внутри уровня", () => {
    expect(levelProgress(bp({ xp: 250, level: 1 }))).toEqual({ current: 50, needed: 200, percentage: 25 });
  });
});

describe("поиск выполненных заданий", () => {
  const streak = { id: "s", type: "streak_fives", target: 2, xp: 100 };
  const week = { id: "w", type: "total_grades_week", target: 2, xp: 50 };
  const avg = { id: "a", type: "average_score", target: 4.5, xp: 150 };

  it("streak_fives: последние N записей — пятёрки", () => {
    const history = [{ grade: 5, date: "17.10.2026" }, { grade: 5, date: "17.10.2026" }];
    expect(findCompletedTasks(bp({ tasks: [streak] }), history, NOW).map(t => t.id)).toEqual(["s"]);
    expect(findCompletedTasks(bp({ tasks: [streak] }), history.slice(0, 1), NOW)).toEqual([]);
  });

  it("streak_fives: выдача денег, бонус и награда пропуска серию не рвут — рвут только другие оценки", () => {
    const three = { ...streak, target: 3 };
    const money = [
      { grade: "—", subject: "💸 Выдано", reward: -500, date: "17.10.2026" },
      { grade: "—", subject: "🎁 Бонус от администратора", reward: 300, date: "17.10.2026" },
      { grade: "—", subject: "🏆 Награда BP (Ур.1)", reward: 500, date: "17.10.2026" }
    ];
    const five = { grade: 5, date: "17.10.2026" };
    const history = [five, money[0], five, money[1], money[2], five];
    expect(findCompletedTasks(bp({ tasks: [three] }), history, NOW).map(t => t.id)).toEqual(["s"]);
    // Четвёрка внутри — серия рвётся
    const broken = [five, money[0], five, { grade: 4, date: "17.10.2026" }, five];
    expect(findCompletedTasks(bp({ tasks: [three] }), broken, NOW)).toEqual([]);
  });

  it("total_grades_week: записи за последние 7 дней", () => {
    const history = [{ grade: 4, date: "17.10.2026" }, { grade: 4, date: "01.10.2026" }];
    expect(findCompletedTasks(bp({ tasks: [week] }), history, NOW)).toEqual([]);
    history.push({ grade: 3, date: "12.10.2026" });
    expect(findCompletedTasks(bp({ tasks: [week] }), history, NOW).map(t => t.id)).toEqual(["w"]);
  });

  it("average_score: средний балл не ниже цели", () => {
    const history = [{ grade: 5, date: "17.10.2026" }, { grade: 4, date: "17.10.2026" }];
    expect(findCompletedTasks(bp({ tasks: [avg] }), history, NOW).map(t => t.id)).toEqual(["a"]);
  });

  it("уже выполненные задания пропускаются", () => {
    const history = [{ grade: 5, date: "17.10.2026" }, { grade: 5, date: "17.10.2026" }];
    expect(findCompletedTasks(bp({ tasks: [streak], completedTasks: ["s"] }), history, NOW)).toEqual([]);
  });
});

describe("засчитывание заданий", () => {
  it("начисляет XP, пересчитывает уровень и отмечает задание", () => {
    const r = completeTasks(bp({ xp: 150 }), [{ id: "t", xp: 100 }]);
    expect(r).toMatchObject({ xp: 250, level: 1, completedTasks: ["t"] });
  });

  it("XP по умолчанию — 100", () => {
    expect(completeTasks(bp(), [{ id: "t" }]).xp).toBe(100);
  });

  it("повторно задание не засчитывается", () => {
    const state = bp({ xp: 150, completedTasks: ["t"] });
    expect(completeTasks(state, [{ id: "t", xp: 100 }])).toBe(state);
  });
});

describe("несколько заданий за раз (баг: XP считался от старого значения)", () => {
  it("XP двух заданий складывается", () => {
    const r = completeTasks(bp({ xp: 150 }), [{ id: "a", xp: 100 }, { id: "b", xp: 50 }]);
    expect(r).toMatchObject({ xp: 300, level: 1, completedTasks: ["a", "b"] });
  });

  it("одно и то же задание дважды в списке засчитывается один раз", () => {
    expect(completeTasks(bp(), [{ id: "a", xp: 100 }, { id: "a", xp: 100 }]).xp).toBe(100);
  });
});
