// Правила наград — продуктовая спецификация в public/faq.html («Базовые награды», «Бонусы»).
import { compareNewestFirst, compareOldestFirst } from "./dates.js";

export const BASE_REWARDS = { 5: 250, 4: 100, 3: -500, 2: -2000 };

const DOUBLE_KILL = "Удвоение за 2 пятёрки за день";
const TRIPLE_KILL = "Утроение за 3 пятёрки за день";
const HAT_TRICK = "Хет-трик 3 пятёрки подряд по предмету";
const SUBJECT_STREAK = "Бонус 2.5 за 2 подряд по предмету";

// Награда за числовую оценку по записям того же дня, добавленным раньше неё (старые → новые).
// Единственное место с правилами бонусов — и для добавления, и для пересчёта.
// Нечисловые оценки («н», «—», выводы, бонусы) в бонусах не участвуют.
function rewardFor(earlierSameDay, { subject, grade }) {
  const reward = BASE_REWARDS[grade] || 0;
  let bonus = 1, bonusDesc = "";
  const dayGrades = earlierSameDay.filter(h => typeof h.grade === 'number');
  const dayFives = dayGrades.filter(h => h.grade === 5).length;
  if (grade === 5 && dayFives === 1) { bonus = 2; bonusDesc = DOUBLE_KILL; }
  if (grade === 5 && dayFives === 2) { bonus = 3; bonusDesc = TRIPLE_KILL; }
  const lastTwo = dayGrades.filter(h => h.subject === subject).slice(-2).map(e => e.grade);
  if (grade === 5) {
    if (lastTwo.length >= 2 && lastTwo[0] === 5 && lastTwo[1] === 5) {
      bonus = 3.5; bonusDesc = HAT_TRICK;
    } else if (lastTwo.length >= 1 && lastTwo[lastTwo.length - 1] === 5) {
      bonus = 2.5; bonusDesc = SUBJECT_STREAK;
    }
  }
  return { reward: reward * bonus, bonus: bonusDesc };
}

// Полный пересчёт наград истории (используется при удалении записи); нечисловые записи — как есть
export function recalculateHistory(entries) {
  const sorted = [...entries].sort(compareOldestFirst);
  const result = [];
  for (const entry of sorted) {
    if (typeof entry.grade !== 'number') { result.push(entry); continue; }
    result.push({ ...entry, ...rewardFor(result.filter(h => h.date === entry.date), entry) });
  }
  return result.sort(compareNewestFirst);
}

// Награда за новую оценку при добавлении: { reward, bonus }. Новая запись — последняя в своём дне.
export function rewardForNewGrade(history, entry) {
  const sameDay = history.filter(h => h.date === entry.date).sort(compareOldestFirst);
  return rewardFor(sameDay, entry);
}

export function computeBalance(history) {
  return history.reduce((sum, e) => sum + (typeof e.reward === 'number' ? e.reward : 0), 0);
}
