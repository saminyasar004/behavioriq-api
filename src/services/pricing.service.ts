import type { PrismaClient } from "@prisma/client";
import { getUserBehavioralProfile } from "./behavioral";
import { generateExplanation } from "./explanation";

export type PersonalizedPricingResult = {
	product_id: string;
	original_price: number;
	offered_price: number;
	discount_pct: number;
	reason: string;
	action_type: string;
};

function resolveDiscountAndAction(
	intentScore: number,
	churnProb: number,
): { discountPct: number; actionType: string } {
	if (churnProb > 0.65) {
		return { discountPct: 25, actionType: "win_back" };
	}
	if (intentScore >= 80) {
		return { discountPct: 0, actionType: "premium" };
	}
	if (intentScore >= 55) {
		return { discountPct: 10, actionType: "nudge_discount" };
	}
	if (intentScore >= 30) {
		return { discountPct: 15, actionType: "moderate_discount" };
	}
	return { discountPct: 20, actionType: "win_back" };
}

export async function getPersonalizedPricing(
	prisma: PrismaClient,
	productId: string,
	userId: string,
): Promise<{ ok: true; data: PersonalizedPricingResult } | { ok: false; notFound: true }> {
	const product = await prisma.product.findUnique({
		where: { id: productId },
	});

	if (!product) {
		return { ok: false, notFound: true };
	}

	const profile = await getUserBehavioralProfile(userId, prisma);
	const intentScore = profile?.intentScore ?? 50;
	const churnProb = profile?.churnProbability ?? 0;

	const { discountPct, actionType } = resolveDiscountAndAction(
		intentScore,
		churnProb,
	);

	const offeredPrice = product.basePrice * (1 - discountPct / 100);

	const explanation = await generateExplanation({
		decision_type: "pricing",
		intent_score: intentScore,
		churn_probability: churnProb,
		original_price: product.basePrice,
		offered_price: offeredPrice,
		discount_pct: discountPct,
	});

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

	return {
		ok: true,
		data: {
			product_id: productId,
			original_price: product.basePrice,
			offered_price: offeredPrice,
			discount_pct: discountPct,
			reason: explanation,
			action_type: actionType,
		},
	};
}
