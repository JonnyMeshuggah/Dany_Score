// Применить миграции из drizzle/ к базе DATABASE_URL. Запускает человек — к ветке Neon для Preview:
//   DATABASE_URL='postgres://…' npm run db:migrate
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Задайте DATABASE_URL (строка подключения к ветке Neon).");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
try {
  await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  console.log(`Миграции применены к ${new URL(url).host}`);
} finally {
  await pool.end();
}
