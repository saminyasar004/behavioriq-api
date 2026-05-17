import type { PrismaClient } from "../prisma";

function startOfWeekUtc(): Date {
	const d = new Date();
	const day = d.getUTCDay();
	const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
	d.setUTCDate(diff);
	d.setUTCHours(0, 0, 0, 0);
	return d;
}

export async function getOverviewStats(prisma: PrismaClient) {
	const weekStart = startOfWeekUtc();
	const [userCount, eventCount, eventsThisWeek, churnCount] = await Promise.all([
		prisma.user.count(),
		prisma.event.count(),
		prisma.event.count({ where: { createdAt: { gte: weekStart } } }),
		prisma.churnPrediction.count({ where: { churnProb: { gt: 0.65 }, resolved: false } }),
	]);

	const pricingAgg = await prisma.pricingDecision.aggregate({
		_avg: { discountPct: true },
		_count: true,
	});
	const avgDiscount = pricingAgg._avg.discountPct ?? 0;
	const revenueLifted = Math.min(
		24,
		Math.round((Number(avgDiscount) || 0) * 0.35 * 10) / 10,
	);
	const conversionRate = Math.min(
		8.5,
		Math.round((eventsThisWeek / Math.max(userCount, 1)) * 120) / 10,
	);

	return {
		totalUsers: userCount,
		totalEvents: eventCount,
		totalEventsThisWeek: eventsThisWeek,
		revenueLifted,
		conversionRate,
		churnAlerts: churnCount,
	};
}

export async function getChurnAlerts(prisma: PrismaClient) {
	const alerts = await prisma.churnPrediction.findMany({
		where: { churnProb: { gt: 0.65 }, resolved: false },
		orderBy: { predictedAt: "desc" },
		include: { user: { select: { id: true, email: true } } },
	});
	return { alerts, count: alerts.length };
}

export type PricingLogFilters = {
	limit: number;
	userId?: string;
	actionType?: string;
	from?: Date;
	to?: Date;
};

export async function getPricingLog(
	prisma: PrismaClient,
	filters: PricingLogFilters,
) {
	const { limit, userId, actionType, from, to } = filters;
	const decisions = await prisma.pricingDecision.findMany({
		where: {
			...(userId ? { userId } : {}),
			...(actionType ? { actionType } : {}),
			...(from || to
				? {
						createdAt: {
							...(from ? { gte: from } : {}),
							...(to ? { lte: to } : {}),
						},
					}
				: {}),
		},
		take: limit,
		orderBy: { createdAt: "desc" },
		include: {
			user: { select: { id: true, email: true } },
			product: { select: { id: true, name: true } },
		},
	});
	return { decisions, count: decisions.length };
}

export async function getSearchAnalytics(prisma: PrismaClient) {
	const [total, personalized, withClick] = await Promise.all([
		prisma.searchLog.count(),
		prisma.searchLog.count({ where: { personalized: true } }),
		prisma.searchLog.findMany({
			where: { clickedRank: { not: null } },
			select: { clickedRank: true },
		}),
	]);

	const top = await prisma.searchLog.groupBy({
		by: ["query"],
		_count: { query: true },
		orderBy: { _count: { query: "desc" } },
		take: 12,
	});

	const avgRank =
		withClick.length > 0
			? withClick.reduce((s, r) => s + (r.clickedRank ?? 0), 0) / withClick.length
			: null;

	return {
		totalSearches: total,
		personalizationRatePct:
			total > 0 ? Math.round((personalized / total) * 1000) / 10 : 0,
		topQueries: top.map((t) => ({ query: t.query, count: t._count.query })),
		averageClickedRank: avgRank != null ? Math.round(avgRank * 10) / 10 : null,
		searchesWithClickData: withClick.length,
	};
}

export type WhatIfParams = {
	discountPct: number;
	intentLessThan: number;
};

export async function getWhatIf(prisma: PrismaClient, params: WhatIfParams) {
	const { discountPct, intentLessThan } = params;
	const affected = await prisma.behavioralProfile.count({
		where: { intentScore: { lt: intentLessThan } },
	});
	const totalUsers = await prisma.user.count();
	const share = totalUsers > 0 ? affected / totalUsers : 0;

	const conversionLiftPct = Math.min(
		18,
		Math.round(discountPct * 0.12 * share * 1000) / 10,
	);
	const revenueImpact = Math.round(
		affected * 85 * (discountPct / 100) * (0.5 + share),
	);

	return {
		discountPct,
		intentLessThan,
		usersAffected: affected,
		totalUsers,
		predictedConversionLiftPct: conversionLiftPct,
		estimatedMonthlyRevenueImpact: revenueImpact,
		formula:
			"conversionLiftPct ≈ min(18, discountPct × 0.12 × shareOfEligibleUsers); revenueImpact ≈ usersAffected × baselineOrderValue × discountDepth × demandFactor",
	};
}

export async function resolveChurnAlert(
	prisma: PrismaClient,
	predictionId: string,
): Promise<boolean> {
	try {
		await prisma.churnPrediction.update({
			where: { id: predictionId },
			data: { resolved: true },
		});
		return true;
	} catch {
		return false;
	}
}

function relativeTime(d: Date): string {
	const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
	if (s < 60) return `${s} sec ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m} min ago`;
	const h = Math.floor(m / 60);
	return `${h} hr ago`;
}

function intentLabel(score: number): string {
	if (score >= 80) return "Hot";
	if (score >= 55) return "Interested";
	if (score >= 30) return "Warming";
	if (score < 30) return "Churn risk";
	return "Neutral";
}

export async function getLiveFeed(prisma: PrismaClient) {
	const events = await prisma.event.findMany({
		take: 30,
		orderBy: { createdAt: "desc" },
		include: {
			user: { select: { email: true, id: true } },
			product: { select: { name: true } },
		},
	});
	const profiles = await prisma.behavioralProfile.findMany({
		select: { userId: true, intentScore: true },
	});
	const scoreByUser = new Map(
		profiles.map((p) => [p.userId, p.intentScore]),
	);

	return events.map((e) => ({
		id: e.id,
		user: e.user.email ?? e.userId.slice(0, 8),
		event: `${e.eventType}${e.product ? ` · ${e.product.name}` : ""}`,
		score: Math.round(scoreByUser.get(e.userId) ?? 50),
		intent: intentLabel(Number(scoreByUser.get(e.userId) ?? 50)),
		time: relativeTime(e.createdAt),
	}));
}

export async function getUserBehaviorSnapshot(
	prisma: PrismaClient,
	userId: string,
) {
	const [user, profile] = await Promise.all([
		prisma.user.findUnique({
			where: { id: userId },
			include: { behavioralProfile: true },
		}),
		prisma.behavioralProfile.findUnique({ where: { userId } }),
	]);
	if (!user) return null;
	const p = profile ?? user.behavioralProfile;
	if (!p) {
		return {
			id: userId,
			name: user.email ?? userId,
			segment: "Unknown",
			intentScore: 50,
			churnProbability: 0,
			visitCount: 0,
			cartAdds: 0,
			searches: 0,
			daysSinceLastPurchase: null,
			priceSensitivity: 0.5,
			premiumAffinity: 0.5,
			budgetAffinity: 0.5,
			action: "standard",
			color: "slate",
			summary: "No behavioral profile yet.",
		};
	}
	return {
		id: userId,
		name: user.email ?? userId,
		segment:
			p.intentScore >= 80
				? "High intent"
				: p.intentScore >= 55
					? "Interested, hesitant"
					: "Win-back risk",
		intentScore: Math.round(p.intentScore),
		churnProbability: p.churnProbability,
		visitCount: p.visitCount,
		cartAdds: 0,
		searches: 0,
		daysSinceLastPurchase: null,
		priceSensitivity: 0.5,
		premiumAffinity: 0.55,
		budgetAffinity: 0.55,
		action: p.recommendedAction,
		color:
			p.churnProbability > 0.65
				? "rose"
				: p.intentScore >= 80
					? "emerald"
					: "amber",
		summary: `Intent ${Math.round(p.intentScore)} with churn risk ${(p.churnProbability * 100).toFixed(0)}%.`,
	};
}
