import { OpenAPIHono } from "@hono/zod-openapi";
import { serve } from "@hono/node-server";
import { PrismaClient } from "@prisma/client";
import { RedisClientType } from "redis";
import { swaggerUI } from "@hono/swagger-ui";
import { eventRoutes } from "./routes/events";
import { pricingRoutes } from "./routes/pricing";
import { searchRoutes } from "./routes/search";
import { dashboardRoutes } from "./routes/dashboard";
import { initializeRedis } from "./services/redis";
import { logger } from "hono/logger";

type Variables = {
	prisma: PrismaClient;
	redis: RedisClientType;
};

const app = new OpenAPIHono<{ Variables: Variables }>();

const dbUrl = process.env.DATABASE_URL || "";

const prisma = new PrismaClient({
	datasources: {
		db: {
			url: dbUrl,
		},
	},
});
let redis: RedisClientType;

// Initialize Redis on startup
(async () => {
	try {
		redis = await initializeRedis();
	} catch (error) {
		console.error("Failed to initialize Redis:", error);
		process.exit(1);
	}
})();

// Global middleware
app.use("*", logger());
app.use("*", async (c, next) => {
	c.set("prisma", prisma);
	c.set("redis", redis);
	await next();
});

// Custom body logger for POST/PUT/PATCH
app.use("*", async (c, next) => {
	if (["POST", "PUT", "PATCH"].includes(c.req.method)) {
		try {
			const body = await c.req.raw.clone().json();
			console.log(`📦 Body:`, JSON.stringify(body, null, 2));
		} catch (e) {
			// Not JSON or empty
		}
	}
	await next();
});

// CORS for development
app.use("*", async (c, next) => {
	c.header("Access-Control-Allow-Origin", "*");
	c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
	c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
	if (c.req.method === "OPTIONS") {
		return c.text("OK");
	}
	await next();
});

// Health check
app.get("/health", (c) => {
	return c.json({
		status: 200,
		message: "API is running.",
		timestamp: new Date().toISOString(),
	});
});

// Routes
app.route("/api/events", eventRoutes);
app.route("/api/pricing", pricingRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/dashboard", dashboardRoutes);

// Swagger Documentation
app.doc("/docs/spec", {
	openapi: "3.0.0",
	info: {
		version: "1.0.0",
		title: "BehaviorIQ API",
		description:
			"AI-powered behavioral commerce intelligence platform API for SMEs. Tracks real-time user behavior, computes intent scores, and drives dynamic pricing and personalized search.",
	},
});

app.get("/docs", swaggerUI({ url: "/docs/spec" }));

// 404 handler
app.notFound((c) => {
	return c.json({ error: "Not found" }, 404);
});

// Error handler
app.onError((err, c) => {
	console.error("Error:", err);
	return c.json({ error: err.message || "Internal server error" }, 500);
});

const port = parseInt(process.env.PORT || "8000");

console.log(`🚀 BehaviorIQ Backend running on http://127.0.0.1:${port}`);
console.log(`📖 Swagger UI available at http://127.0.0.1:${port}/docs`);

serve({
	fetch: app.fetch,
	port,
});

export default app;
export { prisma };
