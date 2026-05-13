import { z } from "@hono/zod-openapi";

export const PixelEventSchema = z.object({
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

export type PixelEventInput = z.infer<typeof PixelEventSchema>;

export const EventBatchRequestSchema = z.object({
	events: z.array(PixelEventSchema),
});

export const EventResponseSchema = z.object({
	success: z.boolean(),
	eventsProcessed: z.number(),
	message: z.string(),
});
