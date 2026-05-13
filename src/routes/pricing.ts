import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getPersonalizedPricing } from "../services/pricing.service";
import { ErrorResponseSchema } from "../schemas/common";
import type { AppVariables } from "../types/bindings";

const PricingResponseSchema = z
	.object({
		product_id: z.string(),
		original_price: z.number(),
		offered_price: z.number(),
		discount_pct: z.number(),
		reason: z.string(),
		action_type: z.string(),
	})
	.openapi("PricingResponse");

export const pricingRoutes = new OpenAPIHono<{ Variables: AppVariables }>();

const getPricingRoute = createRoute({
	method: "get",
	path: "/:productId",
	summary: "Get personalized pricing for a product",
	description:
		"Calculates a dynamic price for a user based on their intent score and churn probability.",
	request: {
		params: z.object({
			productId: z
				.string()
				.openapi({ example: "prod_123", description: "The product ID" }),
		}),
		query: z.object({
			userId: z
				.string()
				.openapi({ example: "user_456", description: "The user ID" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: PricingResponseSchema,
				},
			},
			description: "Personalized pricing details",
		},
		404: {
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
			description: "Product not found",
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

pricingRoutes.openapi(getPricingRoute, async (c) => {
	const prisma = c.get("prisma");
	const { productId } = c.req.valid("param");
	const { userId } = c.req.valid("query");

	try {
		const result = await getPersonalizedPricing(prisma, productId, userId);
		if (!result.ok) {
			return c.json({ error: "Product not found" }, 404);
		}
		return c.json(result.data, 200);
	} catch (error) {
		console.error("Error fetching pricing:", error);
		return c.json({ error: "Failed to fetch pricing" }, 500);
	}
});
