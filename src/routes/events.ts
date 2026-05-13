import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
	EventBatchRequestSchema,
	EventResponseSchema,
} from "../schemas/events";
import { ingestPixelEvents, listRecentEvents } from "../services/events.service";
import { ErrorResponseSchema } from "../schemas/common";
import type { AppVariables } from "../types/bindings";

export const eventRoutes = new OpenAPIHono<{ Variables: AppVariables }>();

const postBatchRoute = createRoute({
	method: "post",
	path: "/batch",
	summary: "Ingest batch of pixel events",
	description:
		"Receives events from the pixel SDK and updates user behavioral profiles.",
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
		const { events } = c.req.valid("json");
		const { eventsProcessed } = await ingestPixelEvents(prisma, events);

		return c.json(
			{
				success: true,
				eventsProcessed,
				message: "Batch ingested successfully",
			},
			200,
		);
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
		const limitNum = Math.min(Math.max(parseInt(limit || "10", 10) || 10, 1), 500);
		const { events, count } = await listRecentEvents(prisma, {
			limit: limitNum,
			userId: userId || undefined,
		});
		return c.json({ events, count }, 200);
	} catch (error) {
		console.error("Error fetching events:", error);
		return c.json({ error: "Failed to fetch events" }, 500);
	}
});
