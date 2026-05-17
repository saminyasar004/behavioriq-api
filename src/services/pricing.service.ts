import type { PrismaClient } from "../prisma";
import { getUserBehavioralProfile } from "./behavioral";
import { generateExplanation } from "./explanation";
import { emitPricingDecision } from "./realtime";

export type PersonalizedPricingResult = {
	product_id: string;
	original_price: number;
	offered_price: number;
	discount_pct: number;
	reason: string;
	action_type: string;
};

function stableUnitInterval(seed: string): number {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0) / 2 ** 32;
}

/** Intent-band multipliers from roadmap (deterministic jitter inside each band). */
function multiplierFromIntent(
	intentScore: number,
	userId: string,
	productId: string,
): { multiplier: number; actionType: string } {
	const key = `${userId}|${productId}|m`;
	const u = stableUnitInterval(key);

	if (intentScore >= 80) {
		return { multiplier: 1.0 + u * 0.05, actionType: "premium" };
	}
	if (intentScore >= 55) {
		return { multiplier: 0.92 + u * (0.99 - 0.92), actionType: "nudge_discount" };
	}
	if (intentScore >= 30) {
		return { multiplier: 0.82 + u * (0.91 - 0.82), actionType: "moderate_discount" };
	}
	return { multiplier: 0.7 + u * (0.81 - 0.7), actionType: "win_back" };
}

function resolvePricing(
	intentScore: number,
	churnProb: number,
	userId: string,
	productId: string,
): { multiplier: number; discountPct: number; actionType: string } {
	if (churnProb > 0.65) {
		const u = stableUnitInterval(`${userId}|${productId}|wb`);
		const multiplier = 0.72 + u * 0.08;
		return {
			multiplier,
			discountPct: Math.round((1 - multiplier) * 1000) / 10,
			actionType: "win_back",
		};
	}

	const { multiplier, actionType } = multiplierFromIntent(
		intentScore,
		userId,
		productId,
	);
	return {
		multiplier,
		discountPct: Math.round((1 - multiplier) * 1000) / 10,
		actionType,
	};
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

	const { multiplier, discountPct, actionType } = resolvePricing(
		intentScore,
		churnProb,
		userId,
		productId,
	);

	const offeredPrice = Math.round(product.basePrice * multiplier * 100) / 100;

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

	emitPricingDecision({
		userId,
		productId,
		offeredPrice,
		discountPct,
		actionType,
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
