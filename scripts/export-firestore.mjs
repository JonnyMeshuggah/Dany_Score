// Полный дамп Firestore в JSON (все коллекции и подколлекции).
// Запуск: FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/key.json npm run backup:firestore
import fs from "node:fs";
import path from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp, GeoPoint, DocumentReference } from "firebase-admin/firestore";

const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath || !fs.existsSync(keyPath)) {
  console.error("❌ Укажи путь к JSON сервисного аккаунта в FIREBASE_SERVICE_ACCOUNT_PATH");
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// Специальные типы Firestore → JSON с пометкой типа, чтобы потом восстановить
function serialize(value) {
  if (value instanceof Timestamp) return { __type: "timestamp", iso: value.toDate().toISOString() };
  if (value instanceof GeoPoint) return { __type: "geopoint", lat: value.latitude, lng: value.longitude };
  if (value instanceof DocumentReference) return { __type: "ref", path: value.path };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __type: "bytes", base64: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
}

async function dumpCollection(colRef) {
  const snap = await colRef.get();
  const docs = [];
  for (const doc of snap.docs) {
    const subcollections = {};
    for (const sub of await doc.ref.listCollections()) {
      subcollections[sub.id] = await dumpCollection(sub);
    }
    docs.push({
      id: doc.id,
      data: serialize(doc.data()),
      ...(Object.keys(subcollections).length ? { subcollections } : {})
    });
  }
  return docs;
}

const collections = {};
for (const col of await db.listCollections()) {
  collections[col.id] = await dumpCollection(col);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve("backups");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `firestore-${serviceAccount.project_id}-${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  projectId: serviceAccount.project_id,
  exportedAt: new Date().toISOString(),
  collections
}, null, 2));

// Короткая сводка, чтобы сразу увидеть расхождения баланса и истории
console.log(`✅ Сохранено: ${outFile}`);
for (const [name, docs] of Object.entries(collections)) {
  console.log(`\n📁 ${name}: ${docs.length} док.`);
  if (name !== "users") continue;
  for (const { id, data } of docs) {
    const history = Array.isArray(data.history) ? data.history : null;
    const sum = history ? history.reduce((s, h) => s + (typeof h.reward === "number" ? h.reward : 0), 0) : null;
    const mismatch = history && typeof data.balance === "number" && sum !== data.balance ? " ⚠️ расхождение" : "";
    console.log(`  ${id}: balance=${data.balance}, history=${history ? history.length : typeof data.history}, сумма истории=${sum}${mismatch}`);
  }
}
