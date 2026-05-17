import type { BehavioralProfile, PrismaClient } from "../prisma";
import {
	callMLChurnPredict,
	callMLIntentScore,
	callMLUserVector,
	type MlIntentFeatures,
} from "./ml-client";
import { cacheGet, cacheSet, CACHE_KEYS } from "./redis";
import { generateExplanation } from "./explanation";
import {
	emitChurnAlert,
	emitHighIntent,
} from "./realtime";

interface EventAggregate {
	visitCount: number;
	cartAdds: number;
	timeOnPageMs: number;
	searchQueries: number;
	pricesSeen: number[];
	maxScrollDepth: number;
	recencyHours: number;
}

interface RFMResult {
	rfmRScore: number;
	rfmFScore: number;
	rfmMScore: number;
	days_since_last_purchase: number;
	total_order_count: number;
	avg_order_value: number;
}

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}

async function getCatalogPriceBounds(prisma: PrismaClient): Promise<{
	min: number;
	max: number;
}> {
	const agg = await prisma.product.aggregate({
		_min: { basePrice: true },
		_max: { basePrice: true },
	});
	const min = agg._min.basePrice ?? 0;
	const max = agg._max.basePrice ?? 1;
	if (max <= min) return { min: 0, max: 1 };
	return { min, max };
}

/**
 * Roadmap intent formula (normalized 0–1 per signal, weights sum to 1, scaled to 0–100):
 * visit_count×0.15 + cart_adds×0.25 + time_on_page×0.20 + search_to_view×0.10
 * + price_range_affinity×0.15 + session_recency×0.15
 */
function computeIntentScoreFromSignals(
	aggregate: EventAggregate,
	priceAffinity: number,
): number {
	const visitNorm = clamp01(aggregate.visitCount / 15);
	const cartNorm = clamp01(aggregate.cartAdds / 8);
	const timeNorm = clamp01(aggregate.timeOnPageMs / 600_000);
	const visits = Math.max(aggregate.visitCount, 1);
	const searchToView = clamp01(aggregate.searchQueries / visits);
	const recencyNorm = clamp01(1 - aggregate.recencyHours / 24);

	const raw =
		visitNorm * 0.15 +
		cartNorm * 0.25 +
		timeNorm * 0.2 +
		searchToView * 0.1 +
		clamp01(priceAffinity) * 0.15 +
		recencyNorm * 0.15;

	return Math.round(raw * 100);
}

function computePriceRangeAffinity(
	pricesSeen: number[],
	catalogMin: number,
	catalogMax: number,
): number {
	if (!pricesSeen.length || catalogMax <= catalogMin) return 0.5;
	const uLow = Math.min(...pricesSeen);
	const uHigh = Math.max(...pricesSeen);
	const span = catalogMax - catalogMin;
	const overlapLow = Math.max(uLow, catalogMin);
	const overlapHigh = Math.min(uHigh, catalogMax);
	const overlap = Math.max(0, overlapHigh - overlapLow);
	return clamp01(overlap / span);
}

function buildMlIntentFeatures(
	aggregate: EventAggregate,
	priceAffinity: number,
): MlIntentFeatures {
	const visits = Math.max(aggregate.visitCount, 1);
	const searchToView = clamp01(aggregate.searchQueries / visits);
	return {
		product_visit_count: clamp01(aggregate.visitCount / 15),
		time_on_product_page: clamp01(aggregate.timeOnPageMs / 600_000),
		cart_add_events: clamp01(aggregate.cartAdds / 8),
		scroll_depth: clamp01(aggregate.maxScrollDepth),
		avg_spend_score: clamp01(priceAffinity),
		session_recency: clamp01(1 - aggregate.recencyHours / 24),
	};
}

export async function getRecentMlProductIds(
	userId: string,
	prisma: PrismaClient,
	limit: number = 12,
): Promise<string[]> {
	const rows = await prisma.event.findMany({
		where: { userId, productId: { not: null } },
		orderBy: { createdAt: "desc" },
		take: 40,
		select: { productId: true },
	});
	const seen = new Set<string>();
	for (const r of rows) {
		if (r.productId && !seen.has(r.productId)) {
			seen.add(r.productId);
			if (seen.size >= limit) break;
		}
	}
	return [...seen];
}

export async function computeUserBehavioralProfile(
	userId: string,
	prisma: PrismaClient,
): Promise<BehavioralProfile | null> {
	const user = await prisma.user.findUnique({ where: { id: userId } });
	if (!user) {
		console.warn(`User ${userId} not found`);
		return null;
	}

	const catalogBounds = await getCatalogPriceBounds(prisma);
	const prevProfile = await prisma.behavioralProfile.findUnique({
		where: { userId },
		select: { intentScore: true },
	});

	const eventAggregate = await aggregateUserEvents(userId, prisma);
	const priceAffinity = computePriceRangeAffinity(
		eventAggregate.pricesSeen,
		catalogBounds.min,
		catalogBounds.max,
	);

	const ruleIntent = computeIntentScoreFromSignals(eventAggregate, priceAffinity);

	let mlIntent = ruleIntent;
	try {
		mlIntent = await callMLIntentScore(
			buildMlIntentFeatures(eventAggregate, priceAffinity),
		);
	} catch (error) {
		console.error("ML intent-score failed, using rule-based intent:", error);
		mlIntent = ruleIntent;
	}

	const intentScore = Math.round(
		Math.max(0, Math.min(100, 0.5 * ruleIntent + 0.5 * mlIntent)),
	);

	const orders = await prisma.order.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
		take: 100,
	});

	const rfm = computeRFM(orders);

	let churnProbability = 0;
	if (orders.length > 0) {
		try {
			churnProbability = await callMLChurnPredict({
				days_since_last_purchase: rfm.days_since_last_purchase,
				total_order_count: rfm.total_order_count,
				avg_order_value: rfm.avg_order_value,
			});
		} catch (error) {
			console.error("Failed to get churn prediction:", error);
			churnProbability = 0.1;
		}
	}

	const recentProductIds = await getRecentMlProductIds(userId, prisma, 12);
	let userVector: number[] = [];
	try {
		const weights =
			recentProductIds.length > 0
				? recentProductIds.map(() => 1 / recentProductIds.length)
				: undefined;
		userVector = await callMLUserVector(
			recentProductIds.length ? recentProductIds : ["rs-001"],
			weights,
		);
	} catch (error) {
		console.error("Failed to get user vector:", error);
		userVector = Array(10).fill(0.5);
	}

	const recommendedAction = determineAction(intentScore, churnProbability);

	const priceRangeLow = Math.min(...eventAggregate.pricesSeen, Infinity);
	const priceRangeHigh = Math.max(...eventAggregate.pricesSeen, 0);

	const profile = await prisma.behavioralProfile.upsert({
		where: { userId },
		update: {
			intentScore,
			churnProbability,
			userVector,
			visitCount: eventAggregate.visitCount,
			totalTimeMs: BigInt(Math.floor(eventAggregate.timeOnPageMs)),
			priceRangeLow: priceRangeLow === Infinity ? 0 : priceRangeLow,
			priceRangeHigh: priceRangeHigh || 0,
			recommendedAction,
			lastComputedAt: new Date(),
		},
		create: {
			userId,
			intentScore,
			churnProbability,
			userVector,
			visitCount: eventAggregate.visitCount,
			totalTimeMs: BigInt(Math.floor(eventAggregate.timeOnPageMs)),
			priceRangeLow: priceRangeLow === Infinity ? 0 : priceRangeLow,
			priceRangeHigh: priceRangeHigh || 0,
			recommendedAction,
		},
	});

	await cacheSet(CACHE_KEYS.userProfile(userId), profile, 1800);

	if (intentScore >= 80 && (prevProfile?.intentScore ?? 0) < 80) {
		emitHighIntent({ userId, intentScore });
	}

	if (churnProbability > 0.65 && orders.length > 0) {
		const recentAlert = await prisma.churnPrediction.findFirst({
			where: {
				userId,
				resolved: false,
				churnProb: { gte: 0.65 },
				predictedAt: {
					gte: new Date(Date.now() - 2 * 60 * 60 * 1000),
				},
			},
		});

		if (!recentAlert) {
			const explanation = await generateExplanation({
				decision_type: "churn",
				intent_score: intentScore,
				churn_probability: churnProbability,
				days_since_purchase: rfm.days_since_last_purchase,
			});

			const winBackPct =
				churnProbability > 0.65 ? Math.min(35, 15 + churnProbability * 25) : 15;

			const prediction = await prisma.churnPrediction.create({
				data: {
					userId,
					rfmRScore: rfm.rfmRScore,
					rfmFScore: rfm.rfmFScore,
					rfmMScore: rfm.rfmMScore,
					churnProb: churnProbability,
					alertSent: false,
					explanation,
					daysSincePurchase: rfm.days_since_last_purchase,
					recommendedWinBackDiscountPct: winBackPct,
				},
			});

			emitChurnAlert({
				userId,
				churnProb: churnProbability,
				predictedAt: prediction.predictedAt.toISOString(),
				explanation,
			});
		}
	}

	return profile;
}

export async function getUserBehavioralProfile(
	userId: string,
	prisma: PrismaClient,
): Promise<BehavioralProfile | null> {
	const cached = await cacheGet<BehavioralProfile>(CACHE_KEYS.userProfile(userId));
	if (cached) return cached;

	return prisma.behavioralProfile.findUnique({
		where: { userId },
	});
}

async function aggregateUserEvents(
	userId: string,
	prisma: PrismaClient,
): Promise<EventAggregate> {
	const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

	const events = await prisma.event.findMany({
		where: {
			userId,
			createdAt: { gte: twentyFourHoursAgo },
		},
	});

	let visitCount = 0;
	let cartAdds = 0;
	let timeOnPageMs = 0;
	let searchQueries = 0;
	const pricesSeen: number[] = [];
	let maxScrollDepth = 0;
	let recencyHours = 24;

	const now = new Date();

	for (const event of events) {
		switch (event.eventType) {
			case "product_view":
			case "product_click": {
				visitCount++;
				const viewPayload = event.payload as Record<string, unknown>;
				if (typeof viewPayload.time_spent_ms === "number") {
					timeOnPageMs += viewPayload.time_spent_ms;
				}
				if (typeof viewPayload.scroll_depth === "number") {
					maxScrollDepth = Math.max(maxScrollDepth, viewPayload.scroll_depth);
				}
				if (typeof viewPayload.price_seen === "number") {
					pricesSeen.push(viewPayload.price_seen);
				}
				recencyHours = Math.min(
					recencyHours,
					(now.getTime() - event.createdAt.getTime()) / (1000 * 60 * 60),
				);
				break;
			}
			case "cart_add":
				cartAdds++;
				break;
			case "search":
				searchQueries++;
				break;
		}
	}

	return {
		visitCount,
		cartAdds,
		timeOnPageMs,
		searchQueries,
		pricesSeen,
		maxScrollDepth,
		recencyHours,
	};
}

function computeRFM(orders: { createdAt: Date; totalAmount: number }[]): RFMResult {
	if (!orders?.length) {
		return {
			rfmRScore: 0,
			rfmFScore: 0,
			rfmMScore: 0,
			days_since_last_purchase: 999,
			total_order_count: 0,
			avg_order_value: 0,
		};
	}

	const lastOrder = orders[0];
	const daysSinceLastPurchase = Math.floor(
		(Date.now() - lastOrder.createdAt.getTime()) / (1000 * 60 * 60 * 24),
	);
	const frequency = orders.length;
	const totalValue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
	const avgOrderValue = totalValue / frequency;

	const rfmRScore = Math.max(0, 1 - Math.min(daysSinceLastPurchase / 90, 1));
	const rfmFScore = Math.min(frequency / 10, 1);
	const rfmMScore = Math.min(avgOrderValue / 10000, 1);

	return {
		rfmRScore,
		rfmFScore,
		rfmMScore,
		days_since_last_purchase: daysSinceLastPurchase,
		total_order_count: frequency,
		avg_order_value: avgOrderValue,
	};
}

function determineAction(
	intentScore: number,
	churnProbability: number,
): string {
	if (churnProbability > 0.65) {
		return "win_back";
	}
	if (intentScore >= 80) {
		return "premium";
	}
	if (intentScore >= 55) {
		return "nudge_discount";
	}
	if (intentScore >= 30) {
		return "moderate_discount";
	}
	return "standard";
}
