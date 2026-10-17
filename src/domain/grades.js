// Добавление оценки целиком: награда, новая история и выполненные задания боевого пропуска.
// Прообраз серверного POST /api/grades (этап 3 MIGRATION_PLAN).
import { compareNewestFirst } from "./dates.js";
import { rewardForNewGrade } from "./rewards.js";
import { findCompletedTasks } from "./battlePass.js";

// input: { id, date: "ДД.ММ.ГГГГ", subject, grade }
export function applyGrade(history, battlePass, input, now = new Date()) {
  const { reward, bonus } = rewardForNewGrade(history, input);
  const entry = { ...input, reward, bonus };
  const newHistory = [entry, ...history].sort(compareNewestFirst);
  const tasks = findCompletedTasks(battlePass, newHistory, now);
  return { entry, history: newHistory, tasks };
}
