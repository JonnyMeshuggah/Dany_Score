// Даты в истории хранятся строкой "ДД.ММ.ГГГГ", в поле <input type="date"> — "ГГГГ-ММ-ДД".

// Значение по умолчанию для поля даты оценки — локальная дата (toISOString дал бы дату в UTC)
export function todayISO(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isoToRuDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// "ДД.ММ.ГГГГ" → локальная полночь; null, если строка не похожа на дату
export function parseRuDate(ru) {
  const parts = String(ru).split('.');
  if (parts.length !== 3) return null;
  return new Date(parts[2], parts[1] - 1, parts[0]);
}

const entryTime = (e) => {
  const [d, m, y] = e.date.split('.');
  return new Date(y, m - 1, d).getTime();
};
const entryId = (e) => parseInt(e.id) || 0;

// Порядок истории в UI: новые даты сверху, внутри дня — по id (время добавления)
// При невалидной дате разница — NaN, и sort считает записи равными (как было в app.js)
export function compareNewestFirst(a, b) {
  const diff = entryTime(b) - entryTime(a);
  return diff !== 0 ? diff : entryId(b) - entryId(a);
}

export function compareOldestFirst(a, b) {
  const diff = entryTime(a) - entryTime(b);
  return diff !== 0 ? diff : entryId(a) - entryId(b);
}
