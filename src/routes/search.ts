import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { PrismaClient } from "@prisma/client";
import { getUserBehavioralProfile } from "../services/behavioral";
import { callMLSearch, generateExplanation } from "../services/external";
import { ErrorResponseSchema } from "../schemas/common";

const SearchResponseSchema = z
	.object({
		results: z.array(z.any()),
		count: z.number(),
		personalized: z.boolean(),
		explanation: z.string(),
	})
	.openapi("SearchResponse");

export const searchRoutes = new OpenAPIHono<{
	Variables: { prisma: PrismaClient };
}>();

const getSearchRoute = createRoute({
	method: "get",
	path: "/",
	summary: "Search products with behavioral re-ranking",
	description:
		"Performs a search and re-ranks results based on the user's behavioral profile and intent.",
	request: {
		query: z.object({
			q: z
				.string()
				.openapi({ example: "laptop", description: "Search query" }),
			userId: z
				.string()
				.openapi({ example: "user_123", description: "The user ID" }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: SearchResponseSchema,
				},
			},
			description: "Search results",
		},
		400: {
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
			description: "Invalid query",
		},
	},
});

searchRoutes.openapi(getSearchRoute, async (c) => {
	const prisma = c.get("prisma");
	const { q: query, userId } = c.req.valid("query");

	if (!query) {
		return c.json({ error: "Query parameter required" }, 400);
	}

	try {
		// Fetch user behavioral profile
		const profile = await getUserBehavioralProfile(userId, prisma);
		const churnScore = profile?.churnProbability || 0;

		// Call ML service for search re-ranking
		const rankedProducts = await callMLSearch(query, churnScore);

		// Call Claude API for explanation
		const explanation = await generateExplanation({
			decision_type: "search",
			query,
			intent_score: profile?.intentScore || 50,
		});

		// Log search query gracefully
		const userExists = await prisma.user.findUnique({
			where: { id: userId },
			select: { id: true },
		});

		if (userExists) {
			await prisma.searchLog.create({
				data: {
					userId,
					query,
					resultsCount: rankedProducts.length,
					personalized: true,
				},
			});
		}

		return c.json({
			results: rankedProducts,
			count: rankedProducts.length,
			personalized: true,
			explanation,
		}, 200);
	} catch (error) {
		console.error("Error searching:", error);
		// Fallback to basic search if ML service fails
		const products = await prisma.product.findMany({
			where: {
				OR: [
					{ name: { contains: query, mode: "insensitive" } },
					{ description: { contains: query, mode: "insensitive" } },
				],
			},
			take: 20,
		});

		return c.json({
			results: products,
			count: products.length,
			personalized: false,
			explanation: "Basic keyword search (personalized re-ranking unavailable)",
		}, 200);
	}
});
