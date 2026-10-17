// Тестовый стенд API: настоящий Postgres в памяти (PGlite) с теми же миграциями, что идут в Neon,
// и локальный RSA-ключ вместо ключей Google для подписи ID-токенов Firebase.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { generateKeyPair, SignJWT } from "jose";
import { fileURLToPath } from "node:url";
import * as schema from "../../server/db/schema.mjs";
import { createApp } from "../../server/app.mjs";
import { createFirebaseVerifier, hashPin } from "../../server/auth.mjs";

export const PROJECT_ID = "dany-score-test";
export const PIN = "4321";
export const ADMIN_TOKEN_SECRET = "x".repeat(32);

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  return { db, close: () => client.close() };
}

const keysPromise = generateKeyPair("RS256");

export async function idToken(uid, overrides = {}) {
  const { privateKey } = await keysPromise;
  const now = Math.floor(Date.now() / 1000);
  const claims = { auth_time: now - 10, email: `${uid}@example.com`, ...overrides.claims };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(overrides.iss ?? `https://securetoken.google.com/${PROJECT_ID}`)
    .setAudience(overrides.aud ?? PROJECT_ID)
    .setSubject(uid)
    .setIssuedAt(now - 10)
    .setExpirationTime(overrides.exp ?? now + 3600)
    .sign(overrides.key ?? privateKey);
}

// now — управляемые часы: тесты двигают время для rate-limit и «сегодня»
export async function createTestApp(db, { now = () => new Date("2026-10-17T12:00:00Z") } = {}) {
  const { publicKey } = await keysPromise;
  return createApp({
    withDb: (fn) => fn(db),
    verifyToken: createFirebaseVerifier({ projectId: PROJECT_ID, keys: publicKey }),
    env: { ADMIN_PIN_HASH: hashPin(PIN), ADMIN_TOKEN_SECRET },
    now
  });
}

let uidSeq = 0;
export const newUid = () => `user-${++uidSeq}`;

// Клиент от имени пользователя: call("POST", "/api/grades", body, { admin: token })
export function clientFor(app, uid) {
  return async function call(method, path, body, { admin, token } = {}) {
    const headers = { authorization: `Bearer ${token ?? await idToken(uid)}` };
    if (admin) headers["x-admin-token"] = admin;
    return app({ method, path, headers, body: body ?? {} });
  };
}

export async function unlock(call) {
  const res = await call("POST", "/api/admin/unlock", { pin: PIN });
  if (res.status !== 200) throw new Error(`unlock: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}
