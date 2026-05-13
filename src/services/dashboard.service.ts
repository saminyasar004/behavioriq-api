import type { PrismaClient } from "@prisma/client";

export async function getOverviewStats(prisma: PrismaClient) {
	const [userCount, eventCount, churnCount] = await Promise.all([
		prisma.user.count(),
		prisma.event.count(),
		prisma.churnPrediction.count({ where: { churnProb: { gt: 0.65 } } }),
	]);

	return {
		totalUsers: userCount,
		totalEvents: eventCount,
		revenueLifted: 12.5,
		conversionRate: 3.2,
		churnAlerts: churnCount,
	};
}

export async function getChurnAlerts(prisma: PrismaClient) {
	const alerts = await prisma.churnPrediction.findMany({
		where: { churnProb: { gt: 0.65 } },
		orderBy: { predictedAt: "desc" },
		include: { user: { select: { id: true, email: true } } },
	});
	return { alerts, count: alerts.length };
}

export async function getPricingLog(prisma: PrismaClient, limit: number) {
	const decisions = await prisma.pricingDecision.findMany({
		take: limit,
		orderBy: { createdAt: "desc" },
		include: {
			user: { select: { id: true, email: true } },
			product: { select: { id: true, name: true } },
		},
	});
	return { decisions, count: decisions.length };
}
