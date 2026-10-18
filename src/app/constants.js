// Справочники приложения на API. Пока жива Firestore-версия (до этапа 6), в src/App.jsx свои копии.
export const APP_VERSION = "v1.4.0 · API";

export const SUBJECTS = [
  "Алгебра", "Биология", "Теория вероятности", "География", "Геометрия", "Изо", "Английский",
  "Информатика", "История", "Литература", "Математический практикум", "Музыка", "Практикум по русскому",
  "Русский язык", "Технология", "Физика", "Физкультура"
];

export const TASK_TYPES = [
  { value: "streak_fives", label: "Серия пятёрок" },
  { value: "total_grades_week", label: "Оценок за неделю" },
  { value: "average_score", label: "Средний балл" }
];

export const GRADE_COLORS = { 5: "#4caf50", 4: "#2196f3", 3: "#ff9800", 2: "#f44336" };

// Сумма в рублях со знаком: +250 / −500
export const formatRub = (n) => `${n >= 0 ? "+" : ""}${n} ₽`;

// Целое положительное число из поля ввода; иначе null
export function parseAmount(value) {
  const n = Number(String(value).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}
