import { describe, it, expect } from "vitest";
import { loadSeasonPreset, isPresetLoaded, isPresetSeason, PRESET_NAME } from "../../src/domain/seasonPreset.js";
import { findCompletedTasks, levelFromXP } from "../../src/domain/battlePass.js";

const oldBp = {
  season: 1, seasonName: "Осенний апгрейд знаний", maxLevel: 10, xpPerLevel: 200, xp: 650, level: 3,
  tasks: [{ id: "1", name: "old", type: "streak_fives", target: 3, xp: 650 }],
  rewards: [{ id: "2", level: 1, text: "b", type: "badge", badgeNumber: 2 }],
  completedTasks: ["1"], claimedRewards: ["2"], badges: [2]
};
const grade = (g, i) => ({ id: String(i), date: "01.10.2026", subject: "А", grade: g });
// 10 оценок, средний 4.5
const history = [5, 5, 5, 5, 5, 4, 4, 4, 4, 4].map(grade);

describe("признак запущенного пресета для версии на API", () => {
  const base = { season: 1, seasonName: "Осень", maxLevel: 10, xpPerLevel: 200, tasks: [], rewards: [] };
  it("название без заданий пресета (после сброса сезона) — не запущен", () => {
    expect(isPresetSeason({ ...base, seasonName: PRESET_NAME })).toBe(false);
    expect(isPresetSeason(base)).toBe(false);
  });
  it("по заданиям пресета, даже если сезон переименован и id заданий другие", () => {
    const tasks = loadSeasonPreset(base, []).tasks.map((x, i) => ({ ...x, id: 100 + i }));
    expect(isPresetSeason({ ...base, seasonName: "Моя версия", tasks })).toBe(true);
    expect(isPresetSeason({ ...base, tasks: [{ id: 1, name: "3 пятёрки", type: "streak_fives", xp: 100 }] })).toBe(false);
  });
});

describe("пресет сезона", () => {
  it("следующий сезон, прогресс и бейджи с нуля", () => {
    const bp = loadSeasonPreset(oldBp, history);
    expect(bp).toMatchObject({
      season: 2, seasonName: PRESET_NAME, maxLevel: 10, xpPerLevel: 200,
      xp: 0, level: 0, completedTasks: [], claimedRewards: [], badges: []
    });
    expect(bp.tasks).toHaveLength(11);
    expect(bp.rewards).toHaveLength(11);
    expect(isPresetLoaded(oldBp)).toBe(false);
    expect(isPresetLoaded(bp)).toBe(true);
  });

  it("id заданий и наград уникальны, все 5 бейджей разыгрываются", () => {
    const bp = loadSeasonPreset(oldBp, history);
    const ids = [...bp.tasks, ...bp.rewards].map(x => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(bp.rewards.filter(r => r.type === "badge").map(r => r.badgeNumber).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(bp.rewards.find(r => r.level === 3).text).toContain("Макдональдс");
  });

  it("XP заданий хватает на 10-й уровень с запасом", () => {
    const total = loadSeasonPreset(oldBp, history).tasks.reduce((s, t) => s + t.xp, 0);
    expect(total).toBe(2750);
    expect(levelFromXP(total, { xpPerLevel: 200, maxLevel: 10 })).toBe(10);
  });

  it("цели по среднему — выше текущего: (45 + 5k) / (10 + k) для k = 5, 15, 30", () => {
    const targets = loadSeasonPreset(oldBp, history).tasks.filter(t => t.type === "average_score").map(t => t.target);
    expect(targets).toEqual([4.66, 4.8, 4.87]);
  });

  it("задание на средний не засчитывается сразу на следующей обычной оценке", () => {
    const bp = loadSeasonPreset(oldBp, history);
    const done = findCompletedTasks(bp, [grade(4, 99), ...history], new Date(2026, 9, 1));
    expect(done.filter(t => t.type === "average_score")).toEqual([]);
  });

  it("средний 4.996 показывается как 5.00 — цели 5, обычная оценка их не выполняет", () => {
    const nearPerfect = [4, ...Array(249).fill(5)].map(grade);
    const bp = loadSeasonPreset(oldBp, nearPerfect);
    expect(bp.tasks.filter(t => t.type === "average_score").map(t => t.target)).toEqual([5, 5, 5]);
    const done = findCompletedTasks(bp, [grade(4, 999), ...nearPerfect], new Date(2026, 9, 1));
    expect(done.filter(t => t.type === "average_score")).toEqual([]);
  });

  it("цель выше показанного среднего даже при округлении: 4.666… → не 4.66", () => {
    // 14 оценок по 5 и 7 по 4: средний 4.666… показывается как 4.67
    const h = [...Array(14).fill(5), ...Array(7).fill(4)].map(grade);
    const targets = loadSeasonPreset(oldBp, h).tasks.filter(t => t.type === "average_score").map(t => t.target);
    expect(Math.min(...targets)).toBeGreaterThan(4.67);
  });

  it("без оценок цели — 5", () => {
    const targets = loadSeasonPreset(oldBp, []).tasks.filter(t => t.type === "average_score").map(t => t.target);
    expect(targets).toEqual([5, 5, 5]);
  });
});
