// Правила наград — продуктовая спецификация в public/faq.html («Базовые награды», «Бонусы»).
import { compareNewestFirst, compareOldestFirst } from "./dates.js";

export const BASE_REWARDS = { 5: 250, 4: 100, 3: -500, 2: -2000 };

const DOUBLE_KILL = "Удвоение за 2 пятёрки за день";
const TRIPLE_KILL = "Утроение за 3 пятёрки за день";
const HAT_TRICK = "Хет-трик 3 пятёрки подряд по предмету";
const SUBJECT_STREAK = "Бонус 2.5 за 2 подряд по предмету";

// Полный пересчёт наград истории (используется при удалении записи).
// Нечисловые оценки («н», «—», выводы, бонусы) остаются как есть и в бонусах не участвуют.
export function recalculateHistory(entries) {
  const sorted = [...entries].sort(compareOldestFirst);
  const result = [];
  for (const entry of sorted) {
    if (typeof entry.grade !== 'number') { result.push(entry); continue; }
    let reward = BASE_REWARDS[entry.grade] || 0;
    let bonus = 1, bonusDesc = "";
    const dayGrades = result.filter(h => h.date === entry.date && typeof h.grade === 'number');
    const dayFives = dayGrades.filter(h => h.grade === 5).length;
    if (entry.grade === 5 && dayFives === 1) { bonus = 2; bonusDesc = DOUBLE_KILL; }
    if (entry.grade === 5 && dayFives === 2) { bonus = 3; bonusDesc = TRIPLE_KILL; }
    const daySameSubject = result.filter(h => h.date === entry.date && h.subject === entry.subject && typeof h.grade === 'number');
    const lastTwo = daySameSubject.slice(-2).map(e => e.grade);
    if (entry.grade === 5) {
      if (lastTwo.length >= 2 && lastTwo[0] === 5 && lastTwo[1] === 5) {
        bonus = 3.5; bonusDesc = HAT_TRICK;
      } else if (lastTwo.length >= 1 && lastTwo[lastTwo.length - 1] === 5) {
        bonus = 2.5; bonusDesc = SUBJECT_STREAK;
      }
    }
    result.push({ ...entry, reward: reward * bonus, bonus: bonusDesc });
  }
  return result.sort(compareNewestFirst);
}

// Награда за новую оценку при добавлении: { reward, bonus }
export function rewardForNewGrade(history, { date, subject, grade }) {
  let reward = BASE_REWARDS[grade] || 0;
  let bonus = 1;
  let bonusDesc = "";

  const todayGrades = history.filter(h => h.date === date);
  const todayFives = todayGrades.filter(h => h.grade === 5).length;
  if (grade === 5 && todayFives === 1) { bonus = 2; bonusDesc = DOUBLE_KILL; }
  if (grade === 5 && todayFives === 2) { bonus = 3; bonusDesc = TRIPLE_KILL; }

  const todaySameSubject = history.filter(h => h.date === date && h.subject === subject)
    .sort((a, b) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0));
  const lastTwo = todaySameSubject.slice(-2).map(e => e.grade);
  if (grade === 5) {
    if (lastTwo.length >= 2 && lastTwo[0] === 5 && lastTwo[1] === 5) {
      bonus = 3.5; bonusDesc = HAT_TRICK;
    } else if (lastTwo.length >= 1 && lastTwo[lastTwo.length - 1] === 5) {
      bonus = 2.5; bonusDesc = SUBJECT_STREAK;
    }
  }

  return { reward: reward * bonus, bonus: bonusDesc };
}

export function computeBalance(history) {
  return history.reduce((sum, e) => sum + (typeof e.reward === 'number' ? e.reward : 0), 0);
}
