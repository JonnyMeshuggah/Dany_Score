// Значения для env в Vercel: ADMIN_PIN_HASH (scrypt от PIN) и случайный ADMIN_TOKEN_SECRET.
// PIN вводится с клавиатуры и не попадает в историю shell:  npm run admin:hash-pin
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { hashPin } from "../server/auth.mjs";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const pin = (await rl.question("PIN админки: ")).trim();
rl.close();
if (pin.length < 4) {
  console.error("PIN — минимум 4 символа.");
  process.exit(1);
}
console.log(`ADMIN_PIN_HASH=${hashPin(pin)}`);
console.log(`ADMIN_TOKEN_SECRET=${randomBytes(32).toString("hex")}`);
