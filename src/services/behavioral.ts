import { PrismaClient } from "@prisma/client";
import { callMLChurnPredict, callMLUserVector } from "./external";
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

export async function computeUserBehavioralProfile(
	userId: string,
	prisma: PrismaClient,
): Promise<any> {
	try {
		// Check if user exists
		const user = await prisma.user.findUnique({ where: { id: userId } });
		if (!user) {
			console.warn(`User ${userId} not found`);
			return null;
		}

		// Aggregate events from last 24 hours
		const eventAggregate = await aggregateUserEvents(userId, prisma);
		const intentScore = computeIntentScore(eventAggregate);

		// Fetch user's order history for RFM
		const orders = await prisma.order.findMany({
			where: { userId },
			orderBy: { createdAt: "desc" },
			take: 100,
		});

		// Compute RFM data
		let churnProbability = 0;
		let userVector: number[] = [];

		if (orders.length > 0) {
			// Returning customer - compute churn
			const rfmData = computeRFM(orders);
			try {
				churnProbability = await callMLChurnPredict(rfmData);
			} catch (error) {
				console.error("Failed to get churn prediction:", error);
				churnProbability = 0.1; // Default low churn for failures
			}
		}

		// Get user vector
		try {
			userVector = await callMLUserVector(userId);
		} catch (error) {
			console.error("Failed to get user vector:", error);
			userVector = Array(10).fill(0.5); // Default neutral vector
		}

		// Determine recommended action
		const recommendedAction = determineAction(
			intentScore,
			churnProbability,
		);

		// Extract price range and categories from events
		const priceRangeLow = Math.min(...eventAggregate.pricesSeen, Infinity);
		const priceRangeHigh = Math.max(...eventAggregate.pricesSeen, 0);

		// Update or create behavioral profile
		const profile = await prisma.behavioralProfile.upsert({
			where: { userId },
			update: {
				intentScore,
				churnProbability,
				userVector,
				visitCount: eventAggregate.visitCount,
				totalTimeMs: eventAggregate.timeOnPageMs,
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
				totalTimeMs: eventAggregate.timeOnPageMs,
				priceRangeLow: priceRangeLow === Infinity ? 0 : priceRangeLow,
				priceRangeHigh: priceRangeHigh || 0,
				recommendedAction,
			},
		});

		// Cache in Redis for 30 minutes
		await cacheSet(CACHE_KEYS.userProfile(userId), profile, 1800);

		// Log churn alert if threshold exceeded
		if (churnProbability > 0.65) {
			await prisma.churnPrediction.create({
				data: {
					userId,
					rfmRScore: computeRFM(orders).rfmRScore || 0,
					rfmFScore: computeRFM(orders).rfmFScore || 0,
					rfmMScore: computeRFM(orders).rfmMScore || 0,
					churnProb: churnProbability,
					alertSent: false,
				},
			});
		}

		return profile;
	} catch (error) {
		console.error("Error computing behavioral profile:", error);
		throw error;
	}
}

export async function getUserBehavioralProfile(
	userId: string,
	prisma: PrismaClient,
): Promise<any> {
	// Try cache first
	const cached = await cacheGet<any>(CACHE_KEYS.userProfile(userId));
	if (cached) return cached;

	// Fall back to DB
	return await prisma.behavioralProfile.findUnique({
		where: { userId },
	});
}

async function aggregateUserEvents(
	userId: string,
	prisma: PrismaClient,
): Promise<EventAggregate> {
	// Get events from last 24 hours
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
	let recencyHours = 24; // Default to 24 hours ago

	const now = new Date();

	for (const event of events) {
		switch (event.eventType) {
			case "product_view":
				visitCount++;
				const viewPayload = event.payload as Record<string, any>;
				if (viewPayload.time_spent_ms) {
					timeOnPageMs += viewPayload.time_spent_ms;
				}
				if (viewPayload.scroll_depth) {
					maxScrollDepth = Math.max(
						maxScrollDepth,
						viewPayload.scroll_depth,
					);
				}
				if (viewPayload.price_seen) {
					pricesSeen.push(viewPayload.price_seen);
				}
				recencyHours = Math.min(
					recencyHours,
					(now.getTime() - event.createdAt.getTime()) /
						(1000 * 60 * 60),
				);
				break;

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
	// Normalize features to 0-1 range
	const visitCountNorm = Math.min(aggregate.visitCount / 10, 1);
	const cartAddsNorm = Math.min(aggregate.cartAdds / 5, 1);
	const timeNorm = Math.min(aggregate.timeOnPageMs / 300000, 1); // 5 min max
	const searchRatio =
		aggregate.visitCount > 0
			? Math.min(aggregate.searchQueries / aggregate.visitCount, 1)
			: 0;
	const scrollNorm = aggregate.maxScrollDepth;
	const recencyNorm = Math.max(1 - aggregate.recencyHours / 24, 0); // More recent = higher

	// Weighted formula
	const intentScore =
		visitCountNorm * 0.15 +
		cartAddsNorm * 0.25 +
		timeNorm * 0.2 +
		searchRatio * 0.1 +
		scrollNorm * 0.15 +
		recencyNorm * 0.15;

	// Scale to 0-100
	return Math.round(intentScore * 100);
}

interface RFMResult {
	rfmRScore?: number;
	rfmFScore?: number;
	rfmMScore?: number;
	days_since_last_purchase: number;
	total_order_count: number;
	avg_order_value: number;
}

function computeRFM(orders: any[]): RFMResult {
	if (!orders || orders.length === 0) {
		return {
			days_since_last_purchase: 999,
			total_order_count: 0,
			avg_order_value: 0,
		};
	}

	// Recency: days since last purchase
	const lastOrder = orders[0];
	const daysSinceLastPurchase = Math.floor(
		(Date.now() - lastOrder.createdAt.getTime()) / (1000 * 60 * 60 * 24),
	);

	// Frequency: total orders
	const frequency = orders.length;

	// Monetary: average order value
	const totalValue = orders.reduce(
		(sum: number, o: any) => sum + o.totalAmount,
		0,
	);
	const avgOrderValue = totalValue / frequency;

	return {
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
