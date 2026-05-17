import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Prisma ORM v7 requires a driver adapter for direct Postgres connections.
 * Connection URL for Migrate/CLI lives in `prisma.config.ts`.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
	const adapter = new PrismaPg({ connectionString });
	return new PrismaClient({ adapter });
}
