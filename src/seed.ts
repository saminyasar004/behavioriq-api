import { loadDotenvOptional } from "./util/load-dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "./prisma";

loadDotenvOptional();

const dbUrl = process.env.DATABASE_URL?.trim();
if (!dbUrl) {
	throw new Error("DATABASE_URL is required to run the seed script");
}
const prisma = createPrismaClient(dbUrl);

type V2Product = {
	id: string;
	name: string;
	desc: string;
	category: string;
	brand: string;
	price: number;
	rating: number;
	popularity: number;
	stock: boolean;
	discount: number;
	image?: string;
};

function pseudoVector(text: string, dim: number): number[] {
	const v = new Array(dim).fill(0);
	for (let i = 0; i < text.length; i++) {
		v[i % dim] += (text.charCodeAt(i) % 97) / 200;
	}
	return v.map((x) => Math.tanh(x));
}

function loadCatalog(): V2Product[] {
	const dir = dirname(fileURLToPath(import.meta.url));
	const catalogPath = join(dir, "data", "products_v2.json");
	const raw = readFileSync(catalogPath, "utf8");
	return JSON.parse(raw) as V2Product[];
}

function minutesAgo(base: Date, minutes: number): Date {
	return new Date(base.getTime() - minutes * 60 * 1000);
}

async function main() {
	console.log("Cleaning database...");
	await prisma.searchLog.deleteMany();
	await prisma.churnPrediction.deleteMany();
	await prisma.pricingDecision.deleteMany();
	await prisma.order.deleteMany();
	await prisma.behavioralProfile.deleteMany();
	await prisma.event.deleteMany();
	await prisma.product.deleteMany();
	await prisma.user.deleteMany();

	console.log("Seeding database...");

	const catalog = loadCatalog().slice(0, 28);

	const user1 = await prisma.user.create({
		data: { email: "hot_buyer@example.com", isAnonymous: false },
	});
	const user2 = await prisma.user.create({
		data: { email: "hesitant_browser@example.com", isAnonymous: false },
	});
	const user3 = await prisma.user.create({
		data: { email: "churning_customer@example.com", isAnonymous: false },
	});

	console.log("✅ Created users");

	const products = await Promise.all(
		catalog.map((p) =>
			prisma.product.create({
				data: {
					id: p.id,
					name: p.name,
					description: p.desc,
					basePrice: p.price,
					category: p.category,
					brand: p.brand,
					stock: p.stock ? Math.round(30 + p.popularity * 120) : 0,
					imageUrl: p.image,
					productVector: pseudoVector(`${p.name} ${p.desc}`, 100),
				},
			}),
		),
	);

	const byId = new Map(products.map((x) => [x.id, x]));
	const pick = (id: string) => {
		const pr = byId.get(id);
		if (!pr) throw new Error(`Missing product ${id} in catalog slice`);
		return pr;
	};

	console.log(`✅ Created ${products.length} products from ML catalog`);

	const neutralVector = Array(100).fill(0.25);

	await prisma.behavioralProfile.create({
		data: {
			userId: user1.id,
			intentScore: 87,
			churnProbability: 0.05,
			userVector: neutralVector,
			visitCount: 6,
			totalTimeMs: BigInt(125000),
			priceRangeLow: 40,
			priceRangeHigh: 160,
			topCategories: ["running_shoes", "trail_shoes"],
			recommendedAction: "premium",
		},
	});

	await prisma.behavioralProfile.create({
		data: {
			userId: user2.id,
			intentScore: 44,
			churnProbability: 0.2,
			userVector: neutralVector,
			visitCount: 8,
			totalTimeMs: BigInt(245000),
			priceRangeLow: 35,
			priceRangeHigh: 95,
			topCategories: ["running_shoes"],
			recommendedAction: "nudge_discount",
		},
	});

	await prisma.behavioralProfile.create({
		data: {
			userId: user3.id,
			intentScore: 21,
			churnProbability: 0.79,
			userVector: neutralVector,
			visitCount: 2,
			totalTimeMs: BigInt(45000),
			priceRangeLow: 35,
			priceRangeHigh: 70,
			topCategories: ["running_shoes"],
			recommendedAction: "win_back",
		},
	});

	console.log("✅ Created behavioral profiles");

	await prisma.order.create({
		data: {
			userId: user1.id,
			totalAmount: 130,
			status: "completed",
			createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
		},
	});
	await prisma.order.create({
		data: {
			userId: user1.id,
			totalAmount: 89.99,
			status: "completed",
			createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
		},
	});
	await prisma.order.create({
		data: {
			userId: user2.id,
			totalAmount: 59.99,
			status: "completed",
			createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
		},
	});
	await prisma.order.create({
		data: {
			userId: user3.id,
			totalAmount: 54.99,
			status: "completed",
			createdAt: new Date(Date.now() - 55 * 24 * 60 * 60 * 1000),
		},
	});

	console.log("✅ Created orders");

	const rs001 = pick("rs-001");
	const rs002 = pick("rs-002");
	const rs003 = pick("rs-003");
	const rs004 = pick("rs-004");
	const rs005 = pick("rs-005");
	const rs006 = pick("rs-006");
	const rs007 = pick("rs-007");
	const rs008 = pick("rs-008");

	const now = new Date();
	const hotBuyerEvents = [
		...Array.from({ length: 6 }, (_, i) => ({
			userId: user1.id,
			sessionId: "session_hot_buyer",
			eventType: "product_view",
			productId: rs001.id,
			payload: {
				time_spent_ms: 12000 + i * 2000,
				scroll_depth: 0.75 + i * 0.02,
				price_seen: rs001.basePrice,
			},
			createdAt: minutesAgo(now, 18 - i * 2),
		})),
		...Array.from({ length: 2 }, (_, i) => ({
			userId: user1.id,
			sessionId: "session_hot_buyer",
			eventType: "cart_add",
			productId: rs001.id,
			payload: { quantity: 1, price_seen: rs001.basePrice },
			createdAt: minutesAgo(now, 5 - i),
		})),
		{
			userId: user1.id,
			sessionId: "session_hot_buyer",
			eventType: "product_click",
			productId: rs001.id,
			payload: {},
			createdAt: minutesAgo(now, 4),
		},
	];

	const hesitantProducts = [rs002, rs003, rs004, rs005, rs006, rs007, rs008, rs002];
	const hesitantEvents = [
		...["running shoes", "lightweight trainers", "marathon gear"].map(
			(query, i) => ({
				userId: user2.id,
				sessionId: "session_hesitant",
				eventType: "search",
				productId: null,
				payload: { query },
				createdAt: minutesAgo(now, 40 - i * 5),
			}),
		),
		...hesitantProducts.map((p, i) => ({
			userId: user2.id,
			sessionId: "session_hesitant",
			eventType: "product_view",
			productId: p.id,
			payload: {
				time_spent_ms: 8000 + i * 500,
				scroll_depth: 0.35 + i * 0.04,
				price_seen: p.basePrice,
			},
			createdAt: minutesAgo(now, 30 - i * 2),
		})),
	];

	const churnEvents = [
		{
			userId: user3.id,
			sessionId: "session_churn",
			eventType: "product_view",
			productId: rs003.id,
			payload: {
				time_spent_ms: 8000,
				scroll_depth: 0.3,
				price_seen: rs003.basePrice,
			},
			createdAt: minutesAgo(now, 120),
		},
		{
			userId: user3.id,
			sessionId: "session_churn",
			eventType: "search",
			productId: null,
			payload: { query: "discount running shoes" },
			createdAt: minutesAgo(now, 90),
		},
		{
			userId: user3.id,
			sessionId: "session_churn",
			eventType: "page_exit",
			productId: rs003.id,
			payload: { time_spent_ms: 8000 },
			createdAt: minutesAgo(now, 85),
		},
	];

	await prisma.event.createMany({
		data: [...hotBuyerEvents, ...hesitantEvents, ...churnEvents],
	});

	await prisma.searchLog.createMany({
		data: [
			{
				userId: user2.id,
				query: "running shoes",
				resultsCount: 12,
				personalized: true,
				clickedRank: 2,
			},
			{
				userId: user1.id,
				query: "nike",
				resultsCount: 6,
				personalized: false,
				clickedRank: 1,
			},
			{
				userId: user3.id,
				query: "running shoes",
				resultsCount: 10,
				personalized: true,
				clickedRank: 3,
			},
		],
	});

	await prisma.churnPrediction.create({
		data: {
			userId: user3.id,
			rfmRScore: 0.2,
			rfmFScore: 0.35,
			rfmMScore: 0.4,
			churnProb: 0.79,
			alertSent: false,
			explanation:
				"This returning customer has not purchased in 55 days and shows weak recent engagement. A win-back discount helps re-activate them before they churn to a competitor.",
			daysSincePurchase: 55,
			recommendedWinBackDiscountPct: 24,
			resolved: false,
		},
	});

	// Sample pricing decisions aligned with demo personas
	await prisma.pricingDecision.createMany({
		data: [
			{
				userId: user1.id,
				productId: rs001.id,
				originalPrice: rs001.basePrice,
				offeredPrice: rs001.basePrice,
				discountPct: 0,
				intentScore: 87,
				churnProb: 0.05,
				actionType: "premium",
				explanation:
					"Strong purchase intent detected — holding standard price to protect margin on a hot buyer.",
			},
			{
				userId: user2.id,
				productId: rs002.id,
				originalPrice: rs002.basePrice,
				offeredPrice: Math.round(rs002.basePrice * 0.88 * 100) / 100,
				discountPct: 12,
				intentScore: 44,
				churnProb: 0.2,
				actionType: "nudge_discount",
				explanation:
					"Strong interest but no commitment — a 12% nudge discount encourages conversion without over-discounting.",
			},
			{
				userId: user3.id,
				productId: rs003.id,
				originalPrice: rs003.basePrice,
				offeredPrice: Math.round(rs003.basePrice * 0.76 * 100) / 100,
				discountPct: 24,
				intentScore: 21,
				churnProb: 0.79,
				actionType: "win_back",
				explanation:
					"At-risk customer with 79% churn probability — aggressive 24% win-back offer to recover the relationship.",
			},
		],
	});

	console.log("✅ Created persona events, search logs, churn alert, pricing samples");
	console.log("🎉 Database seeded successfully!");
	console.log("\n--- Demo personas (map to storefront env) ---");
	console.log(
		JSON.stringify(
			{
				"hot-buyer": {
					userId: user1.id,
					intentScore: 87,
					churnProbability: 0.05,
					demoProductId: rs001.id,
				},
				"hesitant-browser": {
					userId: user2.id,
					intentScore: 44,
					churnProbability: 0.2,
					demoProductId: rs002.id,
				},
				"churning-customer": {
					userId: user3.id,
					intentScore: 21,
					churnProbability: 0.79,
					demoProductId: rs003.id,
				},
			},
			null,
			2,
		),
	);
	console.log("\n--- Optional frontend env ---");
	console.log(
		"NEXT_PUBLIC_BEHAVIORIQ_API_URL=http://127.0.0.1:5000\n" +
			"NEXT_PUBLIC_BEHAVIORIQ_USERS_JSON=" +
			JSON.stringify({
				"hot-buyer": user1.id,
				"hesitant-browser": user2.id,
				"churning-customer": user3.id,
			}),
	);
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
