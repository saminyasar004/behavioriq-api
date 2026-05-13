import type { PrismaClient } from "@prisma/client";
import { getUserBehavioralProfile } from "./behavioral";
import { callMLSearch } from "./ml-client";
import { generateExplanation } from "./explanation";

export type SearchServiceResult = {
	results: unknown[];
	count: number;
	personalized: boolean;
	explanation: string;
};

async function keywordSearch(prisma: PrismaClient, query: string, take: number) {
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

	try {
		const rankedProducts = await callMLSearch(query, churnScore);
		const explanation = await generateExplanation({
			decision_type: "search",
			query,
			intent_score: profile?.intentScore ?? 50,
		});

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

		return {
			results: rankedProducts,
			count: rankedProducts.length,
			personalized: true,
			explanation,
		};
	} catch (error) {
		console.error("ML search failed, using keyword fallback:", error);
		const products = await keywordSearch(prisma, query, 20);
		return {
			results: products,
			count: products.length,
			personalized: false,
			explanation:
				"Basic keyword search (personalized re-ranking unavailable)",
		};
	}
}
