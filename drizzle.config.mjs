// drizzle-kit: генерация SQL-миграций из server/db/schema.mjs. Применяет их scripts/db-migrate.mjs.
export default {
  dialect: "postgresql",
  schema: "./server/db/schema.mjs",
  out: "./drizzle"
};
