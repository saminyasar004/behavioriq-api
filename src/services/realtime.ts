import type { Server } from "socket.io";

let io: Server | null = null;

export function initRealtimeSocket(server: Server): void {
	io = server;
	const nsp = io.of("/dashboard");
	nsp.on("connection", (socket) => {
		socket.emit("dashboard:connected", { ok: true });
	});
}

function dashboardEmit(event: string, payload: unknown): void {
	io?.of("/dashboard").emit(event, payload);
}

export function emitChurnAlert(payload: {
	userId: string;
	churnProb: number;
	predictedAt: string;
	explanation?: string | null;
}): void {
	dashboardEmit("churn:alert", payload);
}

export function emitHighIntent(payload: {
	userId: string;
	intentScore: number;
}): void {
	dashboardEmit("intent:high", payload);
}

export function emitPricingDecision(payload: {
	userId: string;
	productId: string;
	offeredPrice: number;
	discountPct: number;
	actionType: string;
}): void {
	dashboardEmit("pricing:decision", payload);
}
