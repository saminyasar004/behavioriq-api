/// <reference types="node" />
import { defineConfig } from "prisma/config";
import { loadDotenvOptional } from "./src/util/load-dotenv";

loadDotenvOptional();

/**
 * CLI (migrate, generate, db push) reads the URL from here — not from `schema.prisma`.
 * Fallback is only for `prisma generate` in environments without `.env`; set `DATABASE_URL` for real DB work.
 */
const databaseUrl =
	process.env.DATABASE_URL?.trim() ||
	"postgresql://postgres:postgres@127.0.0.1:5432/behavioriq";

export default defineConfig({
	schema: "prisma/schema.prisma",
	migrations: {
		path: "prisma/migrations",
		seed: "tsx src/seed.ts",
	},
	datasource: {
		url: databaseUrl,
	},
});
