import type { BehavioralProfile, PrismaClient } from "@prisma/client";
import { callMLChurnPredict, callMLUserVector } from "./ml-client";
import { cacheGet, cacheSet, CACHE_KEYS } from "./redis";

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

export async function computeUserBehavioralProfile(
	userId: string,
	prisma: PrismaClient,
): Promise<BehavioralProfile | null> {
	const user = await prisma.user.findUnique({ where: { id: userId } });
	if (!user) {
		console.warn(`User ${userId} not found`);
		return null;
	}

	const eventAggregate = await aggregateUserEvents(userId, prisma);
	const intentScore = computeIntentScore(eventAggregate);

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

	let userVector: number[] = [];
	try {
		userVector = await callMLUserVector(userId);
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

	if (churnProbability > 0.65 && orders.length > 0) {
		await prisma.churnPrediction.create({
			data: {
				userId,
				rfmRScore: rfm.rfmRScore,
				rfmFScore: rfm.rfmFScore,
				rfmMScore: rfm.rfmMScore,
				churnProb: churnProbability,
				alertSent: false,
			},
		});
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
			case "product_view": {
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

function computeIntentScore(aggregate: EventAggregate): number {
	const visitCountNorm = Math.min(aggregate.visitCount / 10, 1);
	const cartAddsNorm = Math.min(aggregate.cartAdds / 5, 1);
	const timeNorm = Math.min(aggregate.timeOnPageMs / 300000, 1);
	const searchRatio =
		aggregate.visitCount > 0
			? Math.min(aggregate.searchQueries / aggregate.visitCount, 1)
			: 0;
	const scrollNorm = aggregate.maxScrollDepth;
	const recencyNorm = Math.max(1 - aggregate.recencyHours / 24, 0);

	const intentScore =
		visitCountNorm * 0.15 +
		cartAddsNorm * 0.25 +
		timeNorm * 0.2 +
		searchRatio * 0.1 +
		scrollNorm * 0.15 +
		recencyNorm * 0.15;

	return Math.round(intentScore * 100);
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
