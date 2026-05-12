import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { PrismaClient } from "@prisma/client";
import { computeUserBehavioralProfile } from "../services/behavioral";
import { ErrorResponseSchema } from "../schemas/common";

const PixelEventSchema = z.object({
	event_type: z
		.string()
		.openapi({ example: "product_view", description: "Type of event" }),
	user_id: z
		.string()
		.openapi({ example: "user_123", description: "Unique user identifier" }),
	session_id: z.string().openapi({
		example: "sess_456",
		description: "Unique session identifier",
	}),
	payload: z.record(z.string(), z.any()).openapi({
		example: { product_id: "prod_789", price_seen: 2500 },
		description: "Flexible event payload",
	}),
	timestamp: z
		.string()
		.openapi({ example: "2024-05-13T00:00:00Z", description: "ISO8601 timestamp" }),
});

const EventBatchRequestSchema = z.object({
	events: z.array(PixelEventSchema),
});

const EventResponseSchema = z.object({
	success: z.boolean(),
	eventsProcessed: z.number(),
	message: z.string(),
});

export const eventRoutes = new OpenAPIHono<{
	Variables: { prisma: PrismaClient };
}>();

const postBatchRoute = createRoute({
	method: "post",
	path: "/batch",
	summary: "Ingest batch of pixel events",
	description: "Receives events from the pixel SDK and updates user behavioral profiles.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: EventBatchRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: EventResponseSchema,
				},
			},
			description: "Events ingested successfully",
		},
		400: {
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
			description: "Invalid request body",
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

eventRoutes.openapi(postBatchRoute, async (c) => {
	try {
		const prisma = c.get("prisma");
		const body = await c.req.json();

		if (!body.events || !Array.isArray(body.events)) {
			return c.json({ error: "Invalid events array" }, 400);
		}

		// Validate and prepare events
		const eventsToCreate = body.events.map((event: any) => ({
			userId: String(event.user_id),
			sessionId: String(event.session_id),
			eventType: String(event.event_type),
			productId: event.payload?.product_id || null,
			payload: event.payload,
			createdAt: new Date(event.timestamp),
		}));

		// Bulk insert events
		const createdEvents = await prisma.event.createMany({
			data: eventsToCreate,
			skipDuplicates: false,
		});

		console.log(`✅ Ingested ${createdEvents.count} events`);

		// Trigger behavioral profile recompute for each user
		const userIds = new Set<string>(body.events.map((e: any) => String(e.user_id)));
		for (const userId of userIds) {
			try {
				await computeUserBehavioralProfile(userId, prisma);
				console.log(`✅ Updated behavioral profile for user ${userId}`);
			} catch (error) {
				console.error(
					`⚠️  Failed to update profile for user ${userId}:`,
					error,
				);
			}
		}

		return c.json({
			success: true,
			eventsProcessed: createdEvents.count,
			message: "Batch ingested successfully",
		}, 200);
	} catch (error) {
		console.error("Error ingesting events:", error);
		return c.json(
			{ error: "Failed to ingest events", details: String(error) },
			500,
		);
	}
});

const getEventsRoute = createRoute({
	method: "get",
	path: "/",
	summary: "Get recent events",
	request: {
		query: z.object({
			limit: z.string().optional().openapi({ example: "10" }),
			userId: z.string().optional().openapi({ example: "user_123" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						events: z.array(z.any()),
						count: z.number(),
					}),
				},
			},
			description: "List of recent events",
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

eventRoutes.openapi(getEventsRoute, async (c) => {
	try {
		const prisma = c.get("prisma");
		const { limit, userId } = c.req.valid("query");
		const limitNum = parseInt(limit || "10");

		const events = await prisma.event.findMany({
			where: userId ? { userId } : {},
			take: limitNum,
			orderBy: { createdAt: "desc" },
		});

		return c.json({ events, count: events.length }, 200);
	} catch (error) {
		console.error("Error fetching events:", error);
		return c.json({ error: "Failed to fetch events" }, 500);
	}
});
