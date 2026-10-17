// Единая функция Vercel для /api/* (кроме /api/env): rewrite в vercel.json передаёт путь в ?path=.
// Одна функция вместо пятнадцати — лимит функций на тарифе Hobby и общий холодный старт.
import { createApp } from "../server/app.mjs";
import { createFirebaseVerifier } from "../server/auth.mjs";
import { withNeonDb } from "../server/db/client.mjs";

const app = createApp({
  env: process.env,
  verifyToken: createFirebaseVerifier({ projectId: process.env.FIREBASE_PROJECT_ID }),
  withDb: (fn) => withNeonDb(process.env.DATABASE_URL, fn)
});

// Тело — всегда объект: строка, null и массив превращаются в {}
function parseBody(body) {
  let value = body;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export default async function handler(req, res) {
  const path = "/api/" + String(req.query?.path ?? "").replace(/^\/+/, "");
  const out = await app({ method: req.method, path, headers: req.headers, body: parseBody(req.body) });
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.status(out.status);
  if (typeof out.body === "string") res.send(out.body);
  else res.json(out.body ?? {});
}
