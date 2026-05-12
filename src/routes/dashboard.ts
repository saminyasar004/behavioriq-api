import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { PrismaClient } from "@prisma/client";
import { ErrorResponseSchema } from "../schemas/common";

const OverviewResponseSchema = z
	.object({
		totalUsers: z.number(),
		totalEvents: z.number(),
		revenueLifted: z.number(),
		conversionRate: z.number(),
		churnAlerts: z.number(),
	})
	.openapi("OverviewResponse");

export const dashboardRoutes = new OpenAPIHono<{
	Variables: { prisma: PrismaClient };
}>();

const getOverviewRoute = createRoute({
	method: "get",
	path: "/overview",
	summary: "Get dashboard overview stats",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: OverviewResponseSchema,
				},
			},
			description: "Dashboard overview data",
		},
		500: {
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
			description: "Server error",
		},
	},
});

dashboardRoutes.openapi(getOverviewRoute, async (c) => {
	const prisma = c.get("prisma");
	try {
		const [userCount, eventCount, churnCount] = await Promise.all([
			prisma.user.count(),
			prisma.event.count(),
			prisma.churnPrediction.count({ where: { churnProb: { gt: 0.65 } } }),
		]);

		return c.json({
			totalUsers: userCount,
			totalEvents: eventCount,
			revenueLifted: 12.5, // Mock data
			conversionRate: 3.2, // Mock data
			churnAlerts: churnCount,
		}, 200);
	} catch (error) {
		console.error("Error fetching dashboard overview:", error);
		return c.json({ error: "Failed to fetch dashboard data" }, 500);
	}
});

const getChurnAlertsRoute = createRoute({
	method: "get",
	path: "/churn-alerts",
	summary: "Get active churn alerts",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						alerts: z.array(z.any()),
						count: z.number(),
					}),
				},
			},
			description: "List of churn alerts",
		},
		500: {
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
			description: "Server error",
		},
	},
});

dashboardRoutes.openapi(getChurnAlertsRoute, async (c) => {
	const prisma = c.get("prisma");
	try {
		const alerts = await prisma.churnPrediction.findMany({
			where: { churnProb: { gt: 0.65 } },
			orderBy: { predictedAt: "desc" },
			include: { user: { select: { id: true, email: true } } },
		});

		return c.json({
			alerts,
			count: alerts.length,
		}, 200);
	} catch (error) {
		console.error("Error fetching churn alerts:", error);
		return c.json({ error: "Failed to fetch churn alerts" }, 500);
	}
});

const getPricingLogRoute = createRoute({
	method: "get",
	path: "/pricing-log",
	summary: "Get recent pricing decisions",
	request: {
		query: z.object({
			limit: z.string().optional().openapi({ example: "50" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						decisions: z.array(z.any()),
						count: z.number(),
					}),
				},
			},
			description: "List of pricing decisions",
		},
		500: {
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
			description: "Server error",
		},
	},
});

dashboardRoutes.openapi(getPricingLogRoute, async (c) => {
	const prisma = c.get("prisma");
	const { limit } = c.req.valid("query");
	const limitNum = parseInt(limit || "50");

	try {
		const decisions = await prisma.pricingDecision.findMany({
			take: limitNum,
			orderBy: { createdAt: "desc" },
			include: {
				user: { select: { id: true, email: true } },
				product: { select: { id: true, name: true } },
			},
		});

		return c.json({
			decisions,
			count: decisions.length,
		}, 200);
	} catch (error) {
		console.error("Error fetching pricing log:", error);
		return c.json({ error: "Failed to fetch pricing log" }, 500);
	}
});
