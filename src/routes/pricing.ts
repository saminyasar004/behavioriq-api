import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { PrismaClient } from "@prisma/client";
import { getUserBehavioralProfile } from "../services/behavioral";
import { generateExplanation } from "../services/external";
import { ErrorResponseSchema } from "../schemas/common";

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

export const pricingRoutes = new OpenAPIHono<{
	Variables: { prisma: PrismaClient };
}>();

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
		const product = await prisma.product.findUnique({
			where: { id: productId },
		});

		if (!product) {
			return c.json({ error: "Product not found" }, 404);
		}

		// Fetch user behavioral profile
		const profile = await getUserBehavioralProfile(userId, prisma);

		let discountPct = 0;
		let actionType = "standard";
		const intentScore = profile?.intentScore || 50;
		const churnProb = profile?.churnProbability || 0;

		// Apply pricing rules based on intent score
		if (churnProb > 0.65) {
			discountPct = 25; // Aggressive win-back
			actionType = "win_back";
		} else if (intentScore >= 80) {
			discountPct = 0; // High intent, keep margin
			actionType = "premium";
		} else if (intentScore >= 55) {
			discountPct = 10; // Nudge
			actionType = "nudge_discount";
		} else if (intentScore >= 30) {
			discountPct = 15; // Moderate
			actionType = "moderate_discount";
		} else {
			discountPct = 20; // Low intent
			actionType = "win_back";
		}

		const offeredPrice = product.basePrice * (1 - discountPct / 100);

		// Call Claude API for explanation
		const explanation = await generateExplanation({
			decision_type: "pricing",
			intent_score: intentScore,
			churn_probability: churnProb,
			original_price: product.basePrice,
			offered_price: offeredPrice,
			discount_pct: discountPct,
		});

		// Store pricing decision
		await prisma.pricingDecision.create({
			data: {
				userId,
				productId,
				originalPrice: product.basePrice,
				offeredPrice,
				discountPct,
				intentScore,
				churnProb,
				actionType,
				explanation,
			},
		});

		return c.json({
			product_id: productId,
			original_price: product.basePrice,
			offered_price: offeredPrice,
			discount_pct: discountPct,
			reason: explanation,
			action_type: actionType,
		}, 200);
	} catch (error) {
		console.error("Error fetching pricing:", error);
		return c.json({ error: "Failed to fetch pricing" }, 500);
	}
});
