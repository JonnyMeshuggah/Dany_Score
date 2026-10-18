// Готовый сезон боевого пропуска «Пробуждение Силы знаний» — загружается кнопкой в админке.
// Бейджи «Команды Героев»: 1 Сокол Тысячелетия, 2 R2-D2, 3 Штурмовик, 4 C-3PO, 5 Дарт Вейдер.
import { computeGradeStats } from "./stats.js";

export const PRESET_NAME = "Пробуждение Силы знаний";
const ID_PREFIX = "s2-";

// Каким станет средний балл, если добавить k пятёрок. Средний считается за всё время,
// поэтому цели идут от текущего: иначе задание засчитается на первой же оценке.
// Не ниже показанного среднего + 0.01 (задание сравнивает с ним) и не выше 5.
function averageTargets(history) {
  const { stats, totalGrades, average } = computeGradeStats(history);
  const sum = [2, 3, 4, 5].reduce((s, g) => s + g * stats[g], 0);
  const floor = Math.round(parseFloat(average) * 100) + 1;
  return [5, 15, 30].map(k => {
    const target = Math.floor(((sum + 5 * k) / (totalGrades + k)) * 100 + 1e-9);
    return Math.min(500, Math.max(target, floor)) / 100;
  });
}

export function isPresetLoaded(bp) {
  return bp.tasks.some(task => String(task.id).startsWith(ID_PREFIX));
}

// Признак запущенного пресета для версии на API: в БД у заданий свои id, поэтому смотрим на название
// сезона и названия заданий пресета (кроме целей по среднему — их текст зависит от истории).
// Переименование сезона не возвращает кнопку запуска — как и в Firestore-версии.
export function isPresetSeason(bp) {
  if (bp.seasonName === PRESET_NAME) return true;
  const names = new Set(loadSeasonPreset(bp, []).tasks.filter(t => t.type !== "average_score").map(t => t.name));
  return bp.tasks.some(task => names.has(task.name));
}

// Новое состояние пропуска: следующий сезон, задания и награды пресета, прогресс с нуля
export function loadSeasonPreset(bp, history) {
  const [a1, a2, a3] = averageTargets(history);
  const task = (n, name, type, target, xp) => ({ id: `${ID_PREFIX}task-${n}`, name, type, target, xp });
  const reward = (n, level, text, type, extra = {}) => ({ id: `${ID_PREFIX}reward-${n}`, level, text, type, ...extra });
  return {
    ...bp,
    season: (Number(bp.season) || 1) + 1,
    seasonName: PRESET_NAME,
    maxLevel: 10,
    xpPerLevel: 200,
    tasks: [
      task(1, "Первый выстрел: 2 пятёрки подряд", "streak_fives", 2, 100),
      task(2, "Хет-трик падавана: 3 пятёрки подряд", "streak_fives", 3, 150),
      task(3, "Пять звёзд: 5 пятёрок подряд", "streak_fives", 5, 250),
      task(4, "Путь джедая: 7 пятёрок подряд", "streak_fives", 7, 350),
      task(5, "Магистр Йода: 10 пятёрок подряд", "streak_fives", 10, 500),
      task(6, "Разгон гипердвигателя: 5 оценок за неделю", "total_grades_week", 5, 100),
      task(7, "Скорость света: 10 оценок за неделю", "total_grades_week", 10, 200),
      task(8, "Дуга Кесселя: 15 оценок за неделю", "total_grades_week", 15, 300),
      task(9, `Баланс Силы: средний балл ${a1}`, "average_score", a1, 150),
      task(10, `Рыцарь-джедай: средний балл ${a2}`, "average_score", a2, 250),
      task(11, `Совет джедаев: средний балл ${a3}`, "average_score", a3, 400)
    ],
    rewards: [
      reward(1, 1, "💰 500 ₽", "money", { amount: 500 }),
      reward(2, 2, "Бейдж «Штурмовик»", "badge", { badgeNumber: 3 }),
      reward(3, 3, "🍔 Заказ Макдональдс безлимит", "other"),
      reward(4, 4, "Бейдж «R2-D2»", "badge", { badgeNumber: 2 }),
      reward(5, 5, "💰 1000 ₽", "money", { amount: 1000 }),
      reward(6, 6, "Бейдж «C-3PO»", "badge", { badgeNumber: 4 }),
      reward(7, 7, "🎬 Выбор семейного выхода (кино, пицца)", "other"),
      reward(8, 8, "Бейдж «Сокол Тысячелетия»", "badge", { badgeNumber: 1 }),
      reward(9, 9, "💰 2000 ₽", "money", { amount: 2000 }),
      reward(10, 10, "Бейдж «Дарт Вейдер»", "badge", { badgeNumber: 5 }),
      reward(11, 10, "🧱 Набор LEGO Star Wars", "other")
    ],
    xp: 0,
    level: 0,
    completedTasks: [],
    claimedRewards: [],
    badges: []
  };
}
