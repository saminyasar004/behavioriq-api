import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Server } from "socket.io";
import { createPrismaClient } from "./prisma";
import { getConfig } from "./config/env";
import { createApp } from "./app";
import { initializeRedis } from "./services/redis";
import { initMlClient } from "./services/ml-client";
import { initExplanationClient } from "./services/explanation";
import { initRealtimeSocket } from "./services/realtime";

async function main() {
	const config = getConfig();
	initMlClient(config.mlServiceUrl);
	initExplanationClient({
		geminiApiKey: config.geminiApiKey,
	});

	const prisma = createPrismaClient(config.databaseUrl);

	const redis = await initializeRedis(config.redisUrl);
	const app = createApp(prisma, redis, config);

	const httpServer = createServer(getRequestListener(app.fetch));
	const io = new Server(httpServer, {
		cors: { origin: "*" },
		path: "/socket.io",
	});
	initRealtimeSocket(io);

	httpServer.listen(config.port, () => {
		console.log(`BehaviorIQ API — http://127.0.0.1:${config.port}`);
		console.log(`Swagger UI — http://127.0.0.1:${config.port}/docs`);
		console.log(
			`Socket.IO dashboard namespace — http://127.0.0.1:${config.port}/dashboard`,
		);
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
