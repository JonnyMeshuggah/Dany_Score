import { describe, it, expect } from "vitest";
import { LINES, gradeReaction, pickLine, fillLine, greeting, formatReward } from "../../src/domain/buddy.js";

const NOT_FOR_KIDS = ["тупой", "тупая", "глуп", "дурак", "лентя", "позор", "двоечник", "бездар", "идиот"];

describe("gradeReaction", () => {
  const e = (grade, extra = {}) => ({ grade, reward: 0, bonus: "", subject: "Алгебра", ...extra });

  it("каждая оценка — свой вид реплики и настроение", () => {
    expect(gradeReaction(e(5, { reward: 250 }))).toMatchObject({ kind: "five", mood: "party" });
    expect(gradeReaction(e(4))).toMatchObject({ kind: "four", mood: "happy" });
    expect(gradeReaction(e(3))).toMatchObject({ kind: "three", mood: "oops" });
    expect(gradeReaction(e(2))).toMatchObject({ kind: "two", mood: "oops" });
  });

  it("пятёрка с бонусом — комбо, а выполненное задание пропуска важнее всего", () => {
    expect(gradeReaction(e(5, { bonus: "Удвоение за 2 пятёрки за день" })).kind).toBe("combo");
    expect(gradeReaction(e(4), 1).kind).toBe("task");
  });

  it("подставляет сумму со знаком и предмет", () => {
    const r = gradeReaction(e(3, { reward: -500, subject: "Физика" }));
    expect(r.vars).toMatchObject({ reward: "−500 ₽", subject: "Физика" });
  });
});

describe("тексты", () => {
  it("у каждого вида есть реплики и все подстановки известны", () => {
    const known = new Set(["name", "reward", "subject", "bonus", "hello"]);
    for (const [kind, pool] of Object.entries(LINES)) {
      expect(pool.length, kind).toBeGreaterThan(2);
      for (const line of pool) {
        for (const [, key] of line.matchAll(/\{(\w+)\}/g)) expect(known.has(key), `${kind}: ${key}`).toBe(true);
      }
    }
  });

  it("реплики не повторяются", () => {
    const all = Object.values(LINES).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("на плохие оценки — ни одного обидного слова", () => {
    for (const line of [...LINES.three, ...LINES.two, ...LINES.joke]) {
      for (const word of NOT_FOR_KIDS) expect(line.toLowerCase(), line).not.toContain(word);
    }
  });
});

describe("pickLine", () => {
  it("не повторяет предыдущую реплику того же вида", () => {
    for (const r of [0, 0.5, 0.999]) {
      const { index, text } = pickLine("five", { reward: "+250 ₽", subject: "Алгебра" }, 0, () => r);
      expect(index).not.toBe(0);
      expect(text).not.toMatch(/[{}]/);
    }
  });

  it("неизвестный вид — шутка", () => {
    expect(LINES.joke).toContain(pickLine("нет такого", {}, null, () => 0).text);
  });
});

describe("мелочи", () => {
  it("fillLine подставляет имя дроида и пустоту вместо отсутствующего", () => {
    expect(fillLine("Я {name}{missing}!")).toBe("Я Пятик!");
  });

  it("greeting по времени суток", () => {
    expect([greeting(8), greeting(13), greeting(19), greeting(2)])
      .toEqual(["Доброе утро", "Добрый день", "Добрый вечер", "Доброй ночи"]);
  });

  it("formatReward", () => {
    expect([formatReward(250), formatReward(-2000), formatReward(0), formatReward(undefined)])
      .toEqual(["+250 ₽", "−2000 ₽", "", ""]);
  });
});
