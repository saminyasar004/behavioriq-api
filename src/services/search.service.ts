import type { PrismaClient } from "../prisma";
import type { Product } from "../prisma";
import { getRecentMlProductIds, getUserBehavioralProfile } from "./behavioral";
import { callMLSearch } from "./ml-client";
import { generateExplanation } from "./explanation";

export type SearchServiceResult = {
	results: unknown[];
	count: number;
	personalized: boolean;
	explanation: string;
};

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

export async function searchProducts(
	prisma: PrismaClient,
	query: string,
	userId: string,
): Promise<SearchServiceResult> {
	const profile = await getUserBehavioralProfile(userId, prisma);
	const churnScore = profile?.churnProbability ?? 0;

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

	const explanation = await generateExplanation({
		decision_type: "search",
		query,
		intent_score: profile?.intentScore ?? 50,
	});

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
		console.error("ML search failed, falling back to database keyword search:", error);
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
