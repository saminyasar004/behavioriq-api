import type { PrismaClient } from "../prisma";
import { fetchProductVector, type ProductEmbedInput } from "./product-embedding";

export async function listProducts(
	prisma: PrismaClient,
	options: { query?: string; category?: string; take: number },
) {
	const { query, category, take } = options;
	return prisma.product.findMany({
		where: {
			AND: [
				query
					? {
							OR: [
								{ name: { contains: query, mode: "insensitive" } },
								{ description: { contains: query, mode: "insensitive" } },
							],
						}
					: {},
				category
					? { category: { equals: category, mode: "insensitive" } }
					: {},
			],
		},
		take,
		orderBy: { name: "asc" },
	});
}

export async function getProductById(prisma: PrismaClient, id: string) {
	return prisma.product.findUnique({ where: { id } });
}

export type CreateProductInput = {
	id: string;
	name: string;
	description?: string;
	basePrice: number;
	category?: string;
	brand?: string;
	stock?: number;
	imageUrl?: string;
};

export type UpdateProductInput = {
	name?: string;
	description?: string;
	basePrice?: number;
	category?: string;
	brand?: string;
	stock?: number;
	imageUrl?: string | null;
};

function toEmbedInput(
	id: string,
	fields: {
		name: string;
		description?: string | null;
		category?: string | null;
		brand?: string | null;
	},
): ProductEmbedInput {
	return {
		id,
		name: fields.name,
		description: fields.description,
		category: fields.category,
		brand: fields.brand,
	};
}

export async function createProduct(
	prisma: PrismaClient,
	input: CreateProductInput,
) {
	const existing = await prisma.product.findUnique({ where: { id: input.id } });
	if (existing) {
		return { ok: false as const, conflict: true };
	}

	const productVector = await fetchProductVector(
		toEmbedInput(input.id, input),
	);

	const product = await prisma.product.create({
		data: {
			id: input.id,
			name: input.name,
			description: input.description,
			basePrice: input.basePrice,
			category: input.category,
			brand: input.brand,
			stock: input.stock ?? 50,
			imageUrl: input.imageUrl,
			productVector,
		},
	});

	return { ok: true as const, product };
}

export async function updateProduct(
	prisma: PrismaClient,
	id: string,
	input: UpdateProductInput,
) {
	const existing = await prisma.product.findUnique({ where: { id } });
	if (!existing) {
		return { ok: false as const, notFound: true };
	}

	const merged = {
		name: input.name ?? existing.name,
		description:
			input.description !== undefined
				? input.description
				: existing.description,
		category: input.category ?? existing.category,
		brand: input.brand ?? existing.brand,
	};

	const textFieldsChanged =
		input.name !== undefined ||
		input.description !== undefined ||
		input.category !== undefined ||
		input.brand !== undefined;

	let productVector = existing.productVector;
	if (textFieldsChanged) {
		productVector = await fetchProductVector(toEmbedInput(id, merged));
	}

	const product = await prisma.product.update({
		where: { id },
		data: {
			...input,
			productVector,
		},
	});

	return { ok: true as const, product };
}

export async function deleteProduct(prisma: PrismaClient, id: string) {
	const existing = await prisma.product.findUnique({
		where: { id },
		include: { _count: { select: { events: true, pricingDecisions: true } } },
	});
	if (!existing) {
		return { ok: false as const, notFound: true };
	}

	const refs =
		existing._count.events + existing._count.pricingDecisions;
	if (refs > 0) {
		return { ok: false as const, inUse: true, refs };
	}

	await prisma.product.delete({ where: { id } });
	return { ok: true as const };
}
