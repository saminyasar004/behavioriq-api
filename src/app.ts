import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import type { PrismaClient } from "./prisma";
import type { RedisClientType } from "redis";
import { logger } from "hono/logger";
import { eventRoutes } from "./routes/events";
import { pricingRoutes } from "./routes/pricing";
import { searchRoutes } from "./routes/search";
import { dashboardRoutes } from "./routes/dashboard";
import { productRoutes } from "./routes/products";
import type { AppVariables } from "./types/bindings";
import type { AppConfig } from "./config/env";

export function createApp(
	prisma: PrismaClient,
	redis: RedisClientType,
	config: AppConfig,
): OpenAPIHono<{ Variables: AppVariables }> {
	const app = new OpenAPIHono<{ Variables: AppVariables }>();

	app.use("*", logger());
	app.use("*", async (c, next) => {
		c.set("prisma", prisma);
		c.set("redis", redis);
		await next();
	});

	if (config.nodeEnv === "development") {
		app.use("*", async (c, next) => {
			if (["POST", "PUT", "PATCH"].includes(c.req.method)) {
				try {
					const body = await c.req.raw.clone().json();
					console.log("Request body:", JSON.stringify(body, null, 2));
				} catch {
					// not JSON or empty
				}
			}
			await next();
		});
	}

	app.use("*", async (c, next) => {
		c.header("Access-Control-Allow-Origin", "*");
		c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
		c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
		if (c.req.method === "OPTIONS") {
			return c.text("OK");
		}
		await next();
	});

	app.get("/health", (c) => {
		return c.json({
			status: 200,
			message: "API is running.",
			timestamp: new Date().toISOString(),
		});
	});

	app.route("/api/events", eventRoutes);
	app.route("/api/pricing", pricingRoutes);
	app.route("/api/search", searchRoutes);
	app.route("/api/dashboard", dashboardRoutes);
	app.route("/api/products", productRoutes);

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

	app.notFound((c) => c.json({ error: "Not found" }, 404));

	app.onError((err, c) => {
		console.error("Error:", err);
		return c.json({ error: err.message || "Internal server error" }, 500);
	});

	return app;
}
