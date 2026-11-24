import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema/lq.ts",
  out: "./db/migrations/lq",
});
