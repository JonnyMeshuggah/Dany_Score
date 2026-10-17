// Подключение к Neon Postgres. Пул создаётся на запрос и закрывается после него —
// так Neon рекомендует для serverless-функций. Транзакции нужны интерактивные, поэтому Pool (WebSocket),
// а не HTTP-драйвер. Встроенный WebSocket есть с Node 22 — версия закреплена в package.json (engines).
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema.mjs";
import { HttpError } from "../http.mjs";

export async function withNeonDb(databaseUrl, fn) {
  // До подключения Neon (и в Production до этапа 6) API честно отвечает «не настроено»
  if (!databaseUrl) throw new HttpError(503, "db_not_configured");
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on("error", (err) => console.error("Neon pool error:", err)); // ошибка простаивающего соединения
  try {
    return await fn(drizzle(pool, { schema }));
  } finally {
    await pool.end();
  }
}
