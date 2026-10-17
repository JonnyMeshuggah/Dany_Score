import { describe, it, expect } from "vitest";
import { BASE_REWARDS, recalculateHistory, rewardForNewGrade, computeBalance } from "../../src/domain/rewards.js";

// Правила — public/faq.html, разделы «Базовые награды» и «Бонусы»
const D = "17.10.2026";
let seq = 0;
const g = (subject, grade, date = D) => ({ id: String(++seq), date, subject, grade });

// Последовательно добавляет оценки так, как это делает addGrade, и возвращает историю (новые сверху)
function addAll(entries) {
  let history = [];
  for (const e of entries) {
    const { reward, bonus } = rewardForNewGrade(history, e);
    history = [{ ...e, reward, bonus }, ...history];
  }
  return history;
}
const rewardsOf = (entries) => addAll(entries).reverse().map(e => e.reward);

describe("базовые награды", () => {
  it("5 → +250, 4 → +100, 3 → −500, 2 → −2000", () => {
    expect(BASE_REWARDS).toEqual({ 5: 250, 4: 100, 3: -500, 2: -2000 });
    for (const grade of [5, 4, 3, 2]) {
      expect(rewardForNewGrade([], { date: D, subject: "Алгебра", grade }).reward).toBe(BASE_REWARDS[grade]);
    }
  });
});

describe("бонусы за день", () => {
  it("Double kill: вторая пятёрка за день — ×2", () => {
    expect(rewardsOf([g("Алгебра", 5), g("Физика", 5)])).toEqual([250, 500]);
  });

  it("Triple kill: третья пятёрка за день — ×3", () => {
    expect(rewardsOf([g("Алгебра", 5), g("Физика", 5), g("История", 5)])).toEqual([250, 500, 750]);
  });

  it("четвёртая и следующие пятёрки за день — без множителя (текущее поведение)", () => {
    const r = rewardsOf([g("Алгебра", 5), g("Физика", 5), g("История", 5), g("Музыка", 5)]);
    expect(r[3]).toBe(250);
  });

  it("пятёрки разных дней не складываются", () => {
    expect(rewardsOf([g("Алгебра", 5, "16.10.2026"), g("Физика", 5, D)])).toEqual([250, 250]);
  });

  it("4, 3 и 2 бонусов не получают", () => {
    expect(rewardsOf([g("Алгебра", 5), g("Физика", 5), g("История", 4)])[2]).toBe(100);
  });
});

describe("серия по предмету", () => {
  it("2 пятёрки подряд по предмету — ×2.5 (заменяет Double kill)", () => {
    expect(rewardsOf([g("Алгебра", 5), g("Алгебра", 5)])).toEqual([250, 625]);
  });

  it("3 пятёрки подряд по предмету — ×3.5, хет-трик", () => {
    const h = addAll([g("Алгебра", 5), g("Алгебра", 5), g("Алгебра", 5)]);
    expect(h[0].reward).toBe(875);
    expect(h[0].bonus).toMatch(/Хет-трик/);
  });

  it("серия прерывается другой оценкой по предмету", () => {
    const r = rewardsOf([g("Алгебра", 5), g("Алгебра", 4), g("Алгебра", 5)]);
    expect(r).toEqual([250, 100, 500]); // остаётся только Double kill
  });
});

describe("пересчёт истории", () => {
  it("даёт те же награды, что и последовательное добавление", () => {
    const h = addAll([g("Алгебра", 5), g("Физика", 5), g("Алгебра", 5), g("Алгебра", 3), g("История", 5)]);
    const stripped = h.map(({ reward, bonus, ...e }) => e); // eslint-disable-line no-unused-vars
    expect(recalculateHistory(stripped)).toEqual(h);
  });

  it("сортирует новые даты сверху, внутри дня — по id", () => {
    const r = recalculateHistory([g("А", 4, "16.10.2026"), g("Б", 4, D), g("В", 4, D)]);
    expect(r.map(e => e.subject)).toEqual(["В", "Б", "А"]);
  });

  it("нечисловые записи (вывод, «н») не меняет", () => {
    const cash = { id: "x", date: D, subject: "💸 Вывод", grade: "—", reward: -1000, bonus: "" };
    expect(recalculateHistory([cash])).toEqual([cash]);
  });
});

describe("баланс", () => {
  it("сумма числовых наград", () => {
    expect(computeBalance([{ reward: 250 }, { reward: -1000 }, { reward: "—" }])).toBe(-750);
  });
});
