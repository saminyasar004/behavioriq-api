import type { PrismaClient } from "../prisma";
import type { Product } from "../prisma";
import { getRecentMlProductIds, getUserBehavioralProfile } from "./behavioral";
import {
	callMLSearch,
	callMLSearchRerank,
	type SearchRerankCandidate,
} from "./ml-client";
import { generateExplanation } from "./explanation";

export type SearchServiceResult = {
	results: unknown[];
	count: number;
	personalized: boolean;
	explanation: string;
};

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}

function keywordRelevance(name: string, desc: string | null, q: string): number {
	const n = `${name} ${desc ?? ""}`.toLowerCase().trim();
	const query = q.toLowerCase().trim();
	if (!query) return 0.5;
	if (n.includes(query)) return 1;
	const words = query.split(/\s+/).filter(Boolean);
	if (!words.length) return 0.5;
	const hits = words.filter((w) => n.includes(w)).length;
	return clamp01(0.35 + 0.18 * hits);
}

async function keywordSearch(
	prisma: PrismaClient,
	query: string,
	take: number,
): Promise<Product[]> {
	return prisma.product.findMany({
		where: {
			OR: [
				{ name: { contains: query, mode: "insensitive" } },
				{ description: { contains: query, mode: "insensitive" } },
			],
		},
		take,
	});
}

function buildCandidates(
	products: Product[],
	query: string,
): SearchRerankCandidate[] {
	return products.map((p) => ({
		product_id: p.id,
		keyword_score: keywordRelevance(p.name, p.description, query),
		popularity_score: clamp01(p.stock / 200),
		semantic_score: clamp01(p.stock / 200),
		price: p.basePrice,
		category: p.category ?? undefined,
	}));
}

function mergeRerankedProducts(
	products: Product[],
	ranked: { product_id: string }[],
): Product[] {
	const map = new Map(products.map((p) => [p.id, p]));
	const ordered: Product[] = [];
	for (const r of ranked) {
		const p = map.get(r.product_id);
		if (p) ordered.push(p);
	}
	for (const p of products) {
		if (!ordered.includes(p)) ordered.push(p);
	}
	return ordered;
}

export async function searchProducts(
	prisma: PrismaClient,
	query: string,
	userId: string,
): Promise<SearchServiceResult> {
	const profile = await getUserBehavioralProfile(userId, prisma);
	const churnScore = profile?.churnProbability ?? 0;
	const userVector = profile?.userVector?.length ? profile.userVector : null;

	const candidatesPool = await keywordSearch(prisma, query, 40);

	const userExists = await prisma.user.findUnique({
		where: { id: userId },
		select: { id: true },
	});

	const logSearch = async (personalized: boolean, count: number) => {
		if (!userExists) return;
		await prisma.searchLog.create({
			data: {
				userId,
				query,
				resultsCount: count,
				personalized,
			},
		});
	};

	if (candidatesPool.length === 0) {
		const explanation = await generateExplanation({
			decision_type: "search",
			query,
			intent_score: profile?.intentScore ?? 50,
		});
		await logSearch(false, 0);
		return {
			results: [],
			count: 0,
			personalized: false,
			explanation,
		};
	}

	const explanation = await generateExplanation({
		decision_type: "search",
		query,
		intent_score: profile?.intentScore ?? 50,
	});

	if (userVector && userVector.length > 0) {
		try {
			const candidates = buildCandidates(candidatesPool, query);
			const ranked = await callMLSearchRerank({
				user_vector: userVector,
				candidates,
				weights: { vector: 0.5, intent: 0.3, pricing: 0.2 },
			});
			const ordered = mergeRerankedProducts(candidatesPool, ranked);
			await logSearch(true, ordered.length);
			return {
				results: ordered,
				count: ordered.length,
				personalized: true,
				explanation,
			};
		} catch (e) {
			console.warn("search-rerank failed, trying full ML search:", e);
		}
	}

	try {
		const recentIds = await getRecentMlProductIds(userId, prisma, 12);
		const rankedProducts = await callMLSearch(
			query,
			churnScore,
			recentIds.length ? recentIds : undefined,
		);
		await logSearch(true, rankedProducts.length);
		return {
			results: rankedProducts,
			count: rankedProducts.length,
			personalized: true,
			explanation,
		};
	} catch (error) {
		console.error("ML search failed, using keyword fallback:", error);
		const products = await keywordSearch(prisma, query, 20);
		await logSearch(false, products.length);
		return {
			results: products,
			count: products.length,
			personalized: false,
			explanation,
		};
	}
}
