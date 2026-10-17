// Статистика оценок для экрана «Статистика» и задания average_score.
// average — строка с двумя знаками или 0, если оценок нет (так её показывает UI).
export function computeGradeStats(history) {
  const stats = { 2: 0, 3: 0, 4: 0, 5: 0 };
  let totalGrades = 0;
  let totalSum = 0;

  history.forEach(entry => {
    const g = entry.grade;
    if (g === 2 || g === 3 || g === 4 || g === 5) {
      stats[g]++;
      totalGrades++;
      totalSum += g;
    }
  });

  const average = totalGrades > 0 ? (totalSum / totalGrades).toFixed(2) : 0;
  const maxCount = Math.max(stats[2], stats[3], stats[4], stats[5], 1);

  return { stats, average, maxCount, totalGrades };
}
