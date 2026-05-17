import type { PrismaClient } from "../prisma";
import { computeUserBehavioralProfile } from "./behavioral";
import type { PixelEventInput } from "../schemas/events";

export async function ingestPixelEvents(
	prisma: PrismaClient,
	events: PixelEventInput[],
): Promise<{ eventsProcessed: number }> {
	const eventsToCreate = events.map((event) => {
		const payload = event.payload as Record<string, unknown> | undefined;
		const rawPid = payload?.product_id;
		return {
			userId: event.user_id,
			sessionId: event.session_id,
			eventType: event.event_type,
			productId: rawPid != null ? String(rawPid) : null,
			payload: event.payload as object,
			createdAt: new Date(event.timestamp),
		};
	});

	const createdEvents = await prisma.event.createMany({
		data: eventsToCreate,
		skipDuplicates: false,
	});

	const userIds = new Set(events.map((e) => e.user_id));
	for (const userId of userIds) {
		try {
			await computeUserBehavioralProfile(userId, prisma);
		} catch (error) {
			console.error(`Failed to update behavioral profile for user ${userId}:`, error);
		}
	}

	return { eventsProcessed: createdEvents.count };
}

export async function listRecentEvents(
	prisma: PrismaClient,
	options: { limit: number; userId?: string },
) {
	const { limit, userId } = options;
	const events = await prisma.event.findMany({
		where: userId ? { userId } : {},
		take: limit,
		orderBy: { createdAt: "desc" },
	});
	return { events, count: events.length };
}
