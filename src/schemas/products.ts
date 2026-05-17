import { z } from "@hono/zod-openapi";

export const CreateProductBodySchema = z
	.object({
		id: z.string().min(1).openapi({ example: "rs-099" }),
		name: z.string().min(1).openapi({ example: "Trail Runner X" }),
		description: z.string().optional(),
		basePrice: z.number().positive().openapi({ example: 89.99 }),
		category: z.string().optional(),
		brand: z.string().optional(),
		stock: z.number().int().min(0).optional().default(50),
		imageUrl: z.string().url().optional(),
	})
	.openapi("CreateProductBody");

export const UpdateProductBodySchema = z
	.object({
		name: z.string().min(1).optional(),
		description: z.string().optional(),
		basePrice: z.number().positive().optional(),
		category: z.string().optional(),
		brand: z.string().optional(),
		stock: z.number().int().min(0).optional(),
		imageUrl: z.string().url().optional().nullable(),
	})
	.openapi("UpdateProductBody");

export const ProductResponseSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		description: z.string().nullable(),
		basePrice: z.number(),
		category: z.string().nullable(),
		brand: z.string().nullable(),
		stock: z.number(),
		imageUrl: z.string().nullable(),
		productVector: z.array(z.number()).optional(),
		createdAt: z.string(),
	})
	.openapi("ProductResponse");
