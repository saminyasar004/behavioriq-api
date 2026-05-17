import { callMLProductEmbed } from "./ml-client";

export type ProductEmbedInput = {
	id: string;
	name: string;
	description?: string | null;
	category?: string | null;
	brand?: string | null;
};

/** Fetch TF-IDF vector from ML service; falls back to zero vector if ML is down. */
export async function fetchProductVector(
	product: ProductEmbedInput,
	fallbackDim = 100,
): Promise<number[]> {
	try {
		return await callMLProductEmbed({
			product_id: product.id,
			name: product.name,
			description: product.description ?? undefined,
			category: product.category ?? undefined,
			brand: product.brand ?? undefined,
		});
	} catch (error) {
		console.error(
			`ML product-embed failed for ${product.id}, using zero vector:`,
			error,
		);
		return Array(fallbackDim).fill(0);
	}
}
