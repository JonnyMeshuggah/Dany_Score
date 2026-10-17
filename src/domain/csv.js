// Экспорт и импорт истории в CSV — тот же формат, что у кнопок в боковой панели (src/App.jsx).
// Колонки: Дата, Предмет, Оценка, Бонус, Сумма. Строки — от новых к старым.

const HEADER = ["Дата", "Предмет", "Оценка", "Бонус", "Сумма"];

export function historyToCSV(history) {
  const rows = history.map(h => [
    h.date || "",
    h.subject || "",
    h.grade || "",
    h.bonus || "",
    (typeof h.reward === "number" ? h.reward : "")
  ]);
  return [HEADER, ...rows]
    .map(r => r.map(i => `"${String(i).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

// Записи из файла; строки без даты ДД.ММ.ГГГГ пропускаются, суммы — как в файле.
// Первой строке (самой новой) — наибольший id, чтобы сохранить порядок внутри дня.
export function parseHistoryCSV(text, baseId) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(l => l.trim());
  const rows = lines.slice(1)
    .map(line => line
      .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
      .map(x => x.replace(/^"|"$/g, '').replace(/""/g, '"')))
    .filter(p => /^\d{2}\.\d{2}\.\d{4}$/.test(p[0] || ""));
  return rows.map((p, i) => {
    const g = Number(p[2]);
    return {
      id: String(baseId + rows.length - i),
      date: p[0],
      subject: p[1],
      grade: [2, 3, 4, 5].includes(g) ? g : (p[2] || "—"),
      bonus: p[3] || "",
      reward: Number(p[4]) || 0
    };
  });
}
