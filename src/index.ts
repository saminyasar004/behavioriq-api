import { serve } from "@hono/node-server";
import { PrismaClient } from "@prisma/client";
import { getConfig } from "./config/env";
import { createApp } from "./app";
import { initializeRedis } from "./services/redis";
import { initMlClient } from "./services/ml-client";
import { initExplanationClient } from "./services/explanation";

async function main() {
	const config = getConfig();
	initMlClient(config.mlServiceUrl);
	initExplanationClient(config.geminiApiKey);

	const prisma = new PrismaClient({
		datasources: {
			db: { url: config.databaseUrl },
		},
	});

	const redis = await initializeRedis(config.redisUrl);
	const app = createApp(prisma, redis, config);

	console.log(`BehaviorIQ API — http://127.0.0.1:${config.port}`);
	console.log(`Swagger UI — http://127.0.0.1:${config.port}/docs`);

	serve({
		fetch: app.fetch,
		port: config.port,
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
