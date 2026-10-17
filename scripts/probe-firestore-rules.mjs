// Проверка опубликованных правил Firestore снаружи, через REST — как это видит браузер.
// Только тестовый аккаунт! Печатает лишь HTTP-коды и количество документов, содержимое не выводит.
// Запуск:
//   FIREBASE_API_KEY=... FIREBASE_PROJECT_ID=... PROBE_EMAIL=... PROBE_PASSWORD=... \
//     node scripts/probe-firestore-rules.mjs
// Ожидается: свой документ users/{uid} пишется и читается (200), всё остальное — 403.
// «Чужой» документ — несуществующий users/probe-<random>, реальные документы не трогаются.
import crypto from "node:crypto";

const { FIREBASE_API_KEY, FIREBASE_PROJECT_ID, PROBE_EMAIL, PROBE_PASSWORD } = process.env;
const missing = Object.entries({ FIREBASE_API_KEY, FIREBASE_PROJECT_ID, PROBE_EMAIL, PROBE_PASSWORD })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`❌ Не заданы переменные окружения: ${missing.join(", ")}`);
  process.exit(2);
}

const DOCS = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const PROBE_FIELD = "_rulesProbe";

async function signIn() {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PASSWORD, returnSecureToken: true })
    }
  );
  if (!res.ok) {
    console.error(`❌ Вход тестовым аккаунтом не удался: HTTP ${res.status}`);
    process.exit(2);
  }
  const { idToken, localId } = await res.json();
  return { token: idToken, uid: localId };
}

async function call(method, path, { token, query = "", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${DOCS}/${path}${query}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  // Тело читаем только ради количества документов в списке; содержимое не печатаем
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// Запись одного служебного поля, остальные поля документа не затрагиваются
const writeProbe = (path, token) =>
  call("PATCH", path, {
    token,
    query: `?updateMask.fieldPaths=${PROBE_FIELD}`,
    body: { fields: { [PROBE_FIELD]: { timestampValue: new Date().toISOString() } } }
  });

// PATCH с маской поля и без самого поля удаляет это поле
const removeProbe = (path, token) =>
  call("PATCH", path, { token, query: `?updateMask.fieldPaths=${PROBE_FIELD}`, body: { fields: {} } });

const results = [];
function check(name, status, expected, extra = "") {
  const ok = status === expected;
  results.push(ok);
  console.log(`${ok ? "✅" : "❌"} ${name}: HTTP ${status} (ожидается ${expected})${extra}`);
}

const countDocs = (json) => (Array.isArray(json.documents) ? json.documents.length : 0);

const { token, uid } = await signIn();
const own = `users/${uid}`;
const foreign = `users/probe-${crypto.randomBytes(8).toString("hex")}`;

const ownWrite = await writeProbe(own, token);
check("Запись в свой документ", ownWrite.status, 200);

const ownRead = await call("GET", own, { token });
check("Чтение своего документа", ownRead.status, 200);

if (ownWrite.status === 200) {
  const cleanup = await removeProbe(own, token);
  if (cleanup.status !== 200) console.log(`⚠️  Служебное поле ${PROBE_FIELD} не удалено: HTTP ${cleanup.status}`);
}

const listAnon = await call("GET", "users", { query: "?pageSize=300" });
check("Список users без токена", listAnon.status, 403,
  listAnon.status === 200 ? `, видно документов: ${countDocs(listAnon.json)}` : "");

const listAuth = await call("GET", "users", { token, query: "?pageSize=300" });
check("Список users с токеном", listAuth.status, 403,
  listAuth.status === 200 ? `, видно документов: ${countDocs(listAuth.json)}` : "");

const foreignReadAnon = await call("GET", foreign);
check("Чтение чужого документа без токена", foreignReadAnon.status, 403);

const foreignWriteAnon = await writeProbe(foreign);
check("Запись в чужой документ без токена", foreignWriteAnon.status, 403);

const foreignWrite = await writeProbe(foreign, token);
check("Запись в чужой документ с токеном", foreignWrite.status, 403);

// Если правила всё ещё открыты, убираем созданный пробой документ
if (foreignWrite.status === 200 || foreignWriteAnon.status === 200) {
  const del = await call("DELETE", foreign, { token });
  console.log(`⚠️  Пробный документ создан и удалён: HTTP ${del.status}`);
}

const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n❌ Не прошло проверок: ${failed} из ${results.length}` : `\n✅ Все ${results.length} проверок прошли`);
process.exit(failed ? 1 : 0);
