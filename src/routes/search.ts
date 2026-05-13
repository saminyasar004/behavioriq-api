import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { searchProducts } from "../services/search.service";
import { ErrorResponseSchema } from "../schemas/common";
import type { AppVariables } from "../types/bindings";

const SearchResponseSchema = z
	.object({
		results: z.array(z.any()),
		count: z.number(),
		personalized: z.boolean(),
		explanation: z.string(),
	})
	.openapi("SearchResponse");

export const searchRoutes = new OpenAPIHono<{ Variables: AppVariables }>();

const getSearchRoute = createRoute({
	method: "get",
	path: "/",
	summary: "Search products with behavioral re-ranking",
	description:
		"Performs a search and re-ranks results based on the user's behavioral profile and intent.",
	request: {
		query: z.object({
			q: z.string().openapi({ example: "laptop", description: "Search query" }),
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

searchRoutes.openapi(getSearchRoute, async (c) => {
	const prisma = c.get("prisma");
	const { q: query, userId } = c.req.valid("query");

	if (!query.trim()) {
		return c.json({ error: "Query parameter required" }, 400);
	}

	try {
		const payload = await searchProducts(prisma, query, userId);
		return c.json(payload, 200);
	} catch (error) {
		console.error("Error searching:", error);
		return c.json({ error: "Failed to search" }, 500);
	}
});
