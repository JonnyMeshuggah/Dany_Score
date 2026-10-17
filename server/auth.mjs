// Авторизация API.
// Пользователь — ID-токен Firebase Auth в `Authorization: Bearer …` (проверка как в firebase-admin:
// подпись по ключам Google, iss/aud = id проекта, sub, auth_time).
// Админ — `X-Admin-Token`, выдаётся POST /api/admin/unlock по PIN на 30 минут и привязан к uid.
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http.mjs";

const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const ADMIN_AUDIENCE = "dany-score-admin";
export const ADMIN_TOKEN_TTL_SEC = 30 * 60;

const unauthorized = () => new HttpError(401, "unauthorized");
const forbidden = () => new HttpError(403, "forbidden");

let remoteJwks;
const firebaseKeys = () => (remoteJwks ??= createRemoteJWKSet(new URL(FIREBASE_JWKS_URL)));

// keys — для тестов (локальный ключ вместо ключей Google)
export function createFirebaseVerifier({ projectId, keys = firebaseKeys() }) {
  return async function verify(token) {
    if (!projectId) throw new HttpError(503, "auth_not_configured");
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: `https://securetoken.google.com/${projectId}`,
        audience: projectId,
        algorithms: ["RS256"]
      });
      const now = Math.floor(Date.now() / 1000);
      if (typeof payload.sub !== "string" || payload.sub === "" || payload.sub.length > 128) throw new Error("sub");
      if (typeof payload.auth_time !== "number" || payload.auth_time > now) throw new Error("auth_time");
      return { uid: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
    } catch {
      throw unauthorized();
    }
  };
}

export async function requireUser(req, verify) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) throw unauthorized();
  return verify(m[1]);
}

// ---- PIN: "scrypt:<соль hex>:<хэш hex>" (генерирует scripts/hash-pin.mjs)
export function hashPin(pin, salt = randomBytes(16)) {
  return `scrypt:${salt.toString("hex")}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function verifyPin(pin, stored) {
  const parts = String(stored || "").split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const expected = Buffer.from(parts[2], "hex");
  const actual = scryptSync(String(pin), Buffer.from(parts[1], "hex"), expected.length);
  return expected.length > 0 && timingSafeEqual(actual, expected);
}

const secretKey = (secret) => {
  if (!secret || secret.length < 32) throw new HttpError(503, "admin_not_configured");
  return new TextEncoder().encode(secret);
};

export async function issueAdminToken(uid, secret) {
  return new SignJWT({ scope: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(uid)
    .setAudience(ADMIN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_TOKEN_TTL_SEC}s`)
    .sign(secretKey(secret));
}

export async function requireAdmin(req, uid, secret) {
  const token = req.headers["x-admin-token"];
  if (!token) throw forbidden();
  const key = secretKey(secret);
  try {
    const { payload } = await jwtVerify(token, key, { audience: ADMIN_AUDIENCE, algorithms: ["HS256"] });
    if (payload.sub !== uid || payload.scope !== "admin") throw new Error("scope");
  } catch {
    throw forbidden();
  }
}
