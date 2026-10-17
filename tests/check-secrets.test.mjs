import { describe, it, expect } from "vitest";
import { forbiddenName, scanContent } from "../scripts/check-secrets.mjs";

// Фикстуры собираются из частей, чтобы сам тест не срабатывал на проверку секретов
const PEM = "-----BEGIN " + "PRIVATE KEY-----\nMIIE...\n";
const SA = '{ "type": "service' + '_account", "project_id": "x" }';
const PG = "postgres" + "ql://user:p4ss@ep-x.neon.tech/db";

describe("check-secrets: содержимое", () => {
  it("находит приватный ключ", () => expect(scanContent(PEM)).toContain("приватный ключ"));
  it("находит JSON сервисного аккаунта", () => expect(scanContent(SA)).toContain("JSON сервисного аккаунта"));
  it("находит строку подключения с паролем", () => expect(scanContent(PG)).toHaveLength(1));
  it("не реагирует на пустой DATABASE_URL и публичный apiKey", () => {
    expect(scanContent("DATABASE_URL=\napiKey: window.env.FIREBASE_API_KEY")).toEqual([]);
  });
});

describe("check-secrets: имена файлов", () => {
  it.each(["secrets/key.json", "backups/firestore.json", ".env", "api/.env.local", "my-service-account.json"])(
    "запрещает %s", f => expect(forbiddenName(f)).not.toBeNull());
  it.each([".env.example", "app.js", "docs/agents/RULES.md"])(
    "разрешает %s", f => expect(forbiddenName(f)).toBeNull());
});
