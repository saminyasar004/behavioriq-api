import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
	CreateProductBodySchema,
	ProductResponseSchema,
	UpdateProductBodySchema,
} from "../schemas/products";
import {
	createProduct,
	deleteProduct,
	getProductById,
	listProducts,
	updateProduct,
} from "../services/products.service";
import { ErrorResponseSchema } from "../schemas/common";
import type { AppVariables } from "../types/bindings";

export const productRoutes = new OpenAPIHono<{ Variables: AppVariables }>();

function serializeProduct(product: {
	id: string;
	name: string;
	description: string | null;
	basePrice: number;
	category: string | null;
	brand: string | null;
	stock: number;
	imageUrl: string | null;
	productVector?: number[];
	createdAt: Date;
}) {
	return {
		id: product.id,
		name: product.name,
		description: product.description,
		basePrice: product.basePrice,
		category: product.category,
		brand: product.brand,
		stock: product.stock,
		imageUrl: product.imageUrl,
		productVector: product.productVector,
		createdAt: product.createdAt.toISOString(),
	};
}

const listRoute = createRoute({
	method: "get",
	path: "/",
	summary: "List catalog products",
	request: {
		query: z.object({
			q: z.string().optional(),
			category: z.string().optional(),
			limit: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						products: z.array(ProductResponseSchema),
						count: z.number(),
					}),
				},
			},
			description: "Product list",
		},
		500: {
			content: {
				"application/json": { schema: ErrorResponseSchema },
			},
			description: "Server error",
		},
	},
});

productRoutes.openapi(listRoute, async (c) => {
	try {
		const prisma = c.get("prisma");
		const { q, category, limit } = c.req.valid("query");
		const take = Math.min(Math.max(parseInt(limit || "50", 10) || 50, 1), 200);
		const products = await listProducts(prisma, {
			query: q,
			category,
			take,
		});
		return c.json(
			{
				products: products.map(serializeProduct),
				count: products.length,
			},
			200,
		);
	} catch (e) {
		console.error(e);
		return c.json({ error: "Failed to list products" }, 500);
	}
});

const createRouteDef = createRoute({
	method: "post",
	path: "/",
	summary: "Create a catalog product (embeds vector via ML service)",
	request: {
		body: {
			content: {
				"application/json": { schema: CreateProductBodySchema },
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": { schema: ProductResponseSchema },
			},
			description: "Product created",
		},
		409: {
			content: {
				"application/json": { schema: ErrorResponseSchema },
			},
			description: "Product id already exists",
		},
		500: {
			content: {
				"application/json": { schema: ErrorResponseSchema },
			},
			description: "Server error",
		},
	},
});

productRoutes.openapi(createRouteDef, async (c) => {
	try {
		const prisma = c.get("prisma");
		const body = c.req.valid("json");
		const result = await createProduct(prisma, body);
		if (!result.ok) {
			return c.json({ error: "Product id already exists" }, 409);
		}
		return c.json(serializeProduct(result.product), 201);
	} catch (e) {
		console.error(e);
		return c.json({ error: "Failed to create product" }, 500);
	}
});

const getRoute = createRoute({
	method: "get",
	path: "/:id",
	summary: "Get product by id",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: { "application/json": { schema: ProductResponseSchema } },
			description: "Product",
		},
		404: {
			content: { "application/json": { schema: ErrorResponseSchema } },
			description: "Not found",
		},
	},
});

productRoutes.openapi(getRoute, async (c) => {
	const prisma = c.get("prisma");
	const { id } = c.req.valid("param");
	const product = await getProductById(prisma, id);
	if (!product) return c.json({ error: "Not found" }, 404);
	return c.json(serializeProduct(product), 200);
});

const updateRouteDef = createRoute({
	method: "put",
	path: "/:id",
	summary: "Update a product (re-embeds vector when text fields change)",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": { schema: UpdateProductBodySchema },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: ProductResponseSchema },
			},
			description: "Product updated",
		},
		404: {
			content: {
				"application/json": { schema: ErrorResponseSchema },
			},
			description: "Not found",
		},
		500: {
			content: {
				"application/json": { schema: ErrorResponseSchema },
			},
			description: "Server error",
		},
	},
});

productRoutes.openapi(updateRouteDef, async (c) => {
	try {
		const prisma = c.get("prisma");
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await updateProduct(prisma, id, body);
		if (!result.ok) {
			return c.json({ error: "Not found" }, 404);
		}
		return c.json(serializeProduct(result.product), 200);
	} catch (e) {
		console.error(e);
		return c.json({ error: "Failed to update product" }, 500);
	}
});

const deleteRouteDef = createRoute({
	method: "delete",
	path: "/:id",
	summary: "Delete a product (only if unused by events/pricing log)",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		204: { description: "Deleted" },
		404: {
			content: {
				"application/json": { schema: ErrorResponseSchema },
			},
			description: "Not found",
		},
		409: {
			content: {
				"application/json": { schema: ErrorResponseSchema },
			},
			description: "Product referenced by events or pricing decisions",
		},
	},
});

productRoutes.openapi(deleteRouteDef, async (c) => {
	const prisma = c.get("prisma");
	const { id } = c.req.valid("param");
	const result = await deleteProduct(prisma, id);
	if (!result.ok) {
		if ("notFound" in result && result.notFound) {
			return c.json({ error: "Not found" }, 404);
		}
		return c.json(
			{
				error:
					"Product cannot be deleted while referenced by events or pricing decisions",
			},
			409,
		);
	}
	return c.body(null, 204);
});
