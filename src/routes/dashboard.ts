import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
	getChurnAlerts,
	getLiveFeed,
	getOverviewStats,
	getPricingLog,
	getSearchAnalytics,
	getUserBehaviorSnapshot,
	getWhatIf,
	resolveChurnAlert,
} from "../services/dashboard.service";
import { ErrorResponseSchema } from "../schemas/common";
import type { AppVariables } from "../types/bindings";

const OverviewResponseSchema = z
	.object({
		totalUsers: z.number(),
		totalEvents: z.number(),
		totalEventsThisWeek: z.number(),
		revenueLifted: z.number(),
		conversionRate: z.number(),
		churnAlerts: z.number(),
	})
	.openapi("OverviewResponse");

export const dashboardRoutes = new OpenAPIHono<{ Variables: AppVariables }>();

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
		const data = await getOverviewStats(prisma);
		return c.json(data, 200);
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
		const data = await getChurnAlerts(prisma);
		return c.json(data, 200);
	} catch (error) {
		console.error("Error fetching churn alerts:", error);
		return c.json({ error: "Failed to fetch churn alerts" }, 500);
	}
});

const patchResolveChurnRoute = createRoute({
	method: "patch",
	path: "/churn-alerts/{id}/resolve",
	summary: "Mark a churn prediction as resolved",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ ok: z.boolean() }),
				},
			},
			description: "Updated",
		},
		404: {
			content: { "application/json": { schema: ErrorResponseSchema } },
			description: "Not found",
		},
	},
});

dashboardRoutes.openapi(patchResolveChurnRoute, async (c) => {
	const prisma = c.get("prisma");
	const { id } = c.req.valid("param");
	const ok = await resolveChurnAlert(prisma, id);
	if (!ok) return c.json({ error: "Not found" }, 404);
	return c.json({ ok: true }, 200);
});

const getPricingLogRoute = createRoute({
	method: "get",
	path: "/pricing-log",
	summary: "Get recent pricing decisions",
	request: {
		query: z.object({
			limit: z.string().optional().openapi({ example: "50" }),
			userId: z.string().optional(),
			actionType: z.string().optional(),
			from: z.string().optional().openapi({ example: "2025-01-01" }),
			to: z.string().optional().openapi({ example: "2025-12-31" }),
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
	const { limit, userId, actionType, from, to } = c.req.valid("query");
	const limitNum = Math.min(Math.max(parseInt(limit || "50", 10) || 50, 1), 500);

	try {
		const data = await getPricingLog(prisma, {
			limit: limitNum,
			userId: userId || undefined,
			actionType: actionType || undefined,
			from: from ? new Date(from) : undefined,
			to: to ? new Date(to) : undefined,
		});
		return c.json(data, 200);
	} catch (error) {
		console.error("Error fetching pricing log:", error);
		return c.json({ error: "Failed to fetch pricing log" }, 500);
	}
});

const getSearchAnalyticsRoute = createRoute({
	method: "get",
	path: "/search-analytics",
	summary: "Search analytics for dashboard",
	responses: {
		200: {
			content: { "application/json": { schema: z.any() } },
			description: "Aggregates",
		},
		500: {
			content: { "application/json": { schema: ErrorResponseSchema } },
			description: "Server error",
		},
	},
});

dashboardRoutes.openapi(getSearchAnalyticsRoute, async (c) => {
	const prisma = c.get("prisma");
	try {
		const data = await getSearchAnalytics(prisma);
		return c.json(data, 200);
	} catch (error) {
		console.error("Error fetching search analytics:", error);
		return c.json({ error: "Failed to fetch search analytics" }, 500);
	}
});

const getWhatIfRoute = createRoute({
	method: "get",
	path: "/what-if",
	summary: "What-if simulator for discount vs intent threshold",
	request: {
		query: z.object({
			discountPct: z.string().openapi({ example: "12" }),
			intentLessThan: z.string().openapi({ example: "45" }),
		}),
	},
	responses: {
		200: {
			content: { "application/json": { schema: z.any() } },
			description: "What-if projection",
		},
		400: {
			content: { "application/json": { schema: ErrorResponseSchema } },
			description: "Bad request",
		},
	},
});

dashboardRoutes.openapi(getWhatIfRoute, async (c) => {
	const prisma = c.get("prisma");
	const { discountPct, intentLessThan } = c.req.valid("query");
	const d = parseFloat(discountPct);
	const y = parseFloat(intentLessThan);
	if (Number.isNaN(d) || Number.isNaN(y)) {
		return c.json({ error: "discountPct and intentLessThan must be numbers" }, 400);
	}
	const data = await getWhatIf(prisma, {
		discountPct: Math.min(90, Math.max(0, d)),
		intentLessThan: Math.min(100, Math.max(0, y)),
	});
	return c.json(data, 200);
});

const getLiveFeedRoute = createRoute({
	method: "get",
	path: "/live-feed",
	summary: "Recent events for dashboard live feed",
	responses: {
		200: {
			content: { "application/json": { schema: z.any() } },
			description: "Live feed items",
		},
		500: {
			content: { "application/json": { schema: ErrorResponseSchema } },
			description: "Server error",
		},
	},
});

dashboardRoutes.openapi(getLiveFeedRoute, async (c) => {
	const prisma = c.get("prisma");
	try {
		const items = await getLiveFeed(prisma);
		return c.json({ items, count: items.length }, 200);
	} catch (e) {
		console.error(e);
		return c.json({ error: "Failed to load live feed" }, 500);
	}
});

const getUserSnapshotRoute = createRoute({
	method: "get",
	path: "/users/{userId}/behavior",
	summary: "Behavioral snapshot for a user (persona wiring)",
	request: {
		params: z.object({
			userId: z.string().openapi({ param: { name: "userId", in: "path" } }),
		}),
	},
	responses: {
		200: {
			content: { "application/json": { schema: z.any() } },
			description: "User behavior snapshot",
		},
		404: {
			content: { "application/json": { schema: ErrorResponseSchema } },
			description: "User not found",
		},
	},
});

dashboardRoutes.openapi(getUserSnapshotRoute, async (c) => {
	const prisma = c.get("prisma");
	const { userId } = c.req.valid("param");
	const snap = await getUserBehaviorSnapshot(prisma, userId);
	if (!snap) return c.json({ error: "User not found" }, 404);
	return c.json(snap, 200);
});
