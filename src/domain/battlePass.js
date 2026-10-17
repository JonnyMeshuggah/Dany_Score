// Боевой пропуск. Правил в FAQ нет — тесты фиксируют текущее поведение.
import { parseRuDate } from "./dates.js";
import { computeGradeStats } from "./stats.js";

// Уровень начинается с 0 и ограничен maxLevel
export function levelFromXP(xp, { xpPerLevel, maxLevel }) {
  return Math.min(Math.floor(xp / xpPerLevel), maxLevel);
}

export function levelProgress(bp) {
  const xpInCurrentLevel = bp.xp - bp.level * bp.xpPerLevel;
  return {
    current: xpInCurrentLevel,
    needed: bp.xpPerLevel,
    percentage: Math.min((xpInCurrentLevel / bp.xpPerLevel) * 100, 100)
  };
}

// Задания, которые выполнены после добавления оценки. history — уже с новой оценкой, новые сверху.
export function findCompletedTasks(bp, history, now = new Date()) {
  const stats = computeGradeStats(history);
  return bp.tasks.filter(task => {
    if (bp.completedTasks.includes(task.id)) return false;

    if (task.type === 'streak_fives') {
      const recentGrades = history.slice(0, task.target || 3);
      return recentGrades.length >= (task.target || 3) && recentGrades.every(h => h.grade === 5);
    }
    if (task.type === 'total_grades_week') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekGrades = history.filter(h => {
        const d = parseRuDate(h.date);
        return d !== null && d >= weekAgo;
      });
      return weekGrades.length >= (task.target || 10);
    }
    if (task.type === 'average_score') {
      return parseFloat(stats.average) >= (task.target || 4.5);
    }
    return false;
  });
}

// Отметить задания выполненными и начислить XP. Возвращает новое состояние пропуска.
export function completeTasks(bp, tasks) {
  let result = bp;
  for (const task of tasks) {
    if (result.completedTasks.includes(task.id)) continue;
    const xp = result.xp + (task.xp || 100);
    result = {
      ...result,
      completedTasks: [...result.completedTasks, task.id],
      xp,
      level: levelFromXP(xp, bp)
    };
  }
  return result;
}
