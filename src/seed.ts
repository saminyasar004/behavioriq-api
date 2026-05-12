import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

	// Create sample users
	const user1 = await prisma.user.create({
		data: {
			email: "hot_buyer@example.com",
			isAnonymous: false,
		},
	});

	const user2 = await prisma.user.create({
		data: {
			email: "hesitant_browser@example.com",
			isAnonymous: false,
		},
	});

	const user3 = await prisma.user.create({
		data: {
			email: "churning_customer@example.com",
			isAnonymous: false,
		},
	});

	console.log("✅ Created users");

	// Create sample products
	const products = await Promise.all([
		prisma.product.create({
			data: {
				name: "Nike Air Max Running Shoes",
				description: "Premium running shoes with excellent cushioning",
				basePrice: 8500,
				category: "shoes",
				brand: "Nike",
				stock: 50,
			},
		}),
		prisma.product.create({
			data: {
				name: "Adidas Ultraboost Sneakers",
				description: "Comfortable everyday sneakers",
				basePrice: 7200,
				category: "shoes",
				brand: "Adidas",
				stock: 45,
			},
		}),
		prisma.product.create({
			data: {
				name: "Budget Running Shoes",
				description: "Affordable running shoes for beginners",
				basePrice: 2500,
				category: "shoes",
				brand: "Generic",
				stock: 100,
			},
		}),
		prisma.product.create({
			data: {
				name: "Pro Tennis Racket",
				description: "High-performance tennis equipment",
				basePrice: 15000,
				category: "sports",
				brand: "Wilson",
				stock: 20,
			},
		}),
	]);

	console.log("✅ Created products");

	// Create behavioral profiles for each user
	await prisma.behavioralProfile.create({
		data: {
			userId: user1.id,
			intentScore: 87,
			churnProbability: 0.05,
			visitCount: 6,
			totalTimeMs: 125000,
			priceRangeLow: 7000,
			priceRangeHigh: 15000,
			topCategories: ["shoes", "sports"],
			recommendedAction: "premium",
		},
	});

	await prisma.behavioralProfile.create({
		data: {
			userId: user2.id,
			intentScore: 44,
			churnProbability: 0.2,
			visitCount: 8,
			totalTimeMs: 245000,
			priceRangeLow: 2000,
			priceRangeHigh: 5000,
			topCategories: ["shoes"],
			recommendedAction: "nudge_discount",
		},
	});

	await prisma.behavioralProfile.create({
		data: {
			userId: user3.id,
			intentScore: 21,
			churnProbability: 0.79,
			visitCount: 2,
			totalTimeMs: 45000,
			priceRangeLow: 1500,
			priceRangeHigh: 4000,
			topCategories: ["shoes"],
			recommendedAction: "win_back",
		},
	});

	console.log("✅ Created behavioral profiles");

	// Create sample orders for RFM calculation
	await prisma.order.create({
		data: {
			userId: user1.id,
			totalAmount: 8500,
			status: "completed",
			createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
		},
	});

	await prisma.order.create({
		data: {
			userId: user1.id,
			totalAmount: 7200,
			status: "completed",
			createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
		},
	});

	await prisma.order.create({
		data: {
			userId: user2.id,
			totalAmount: 2500,
			status: "completed",
			createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
		},
	});

	await prisma.order.create({
		data: {
			userId: user3.id,
			totalAmount: 3000,
			status: "completed",
			createdAt: new Date(Date.now() - 55 * 24 * 60 * 60 * 1000), // 55 days ago (churning)
		},
	});

	console.log("✅ Created orders");

	// Create sample events
	const now = new Date();
	await prisma.event.createMany({
		data: [
			{
				userId: user1.id,
				sessionId: "session_001",
				eventType: "product_view",
				productId: products[0].id,
				payload: {
					time_spent_ms: 45000,
					scroll_depth: 0.9,
					price_seen: 8500,
				},
				createdAt: new Date(now.getTime() - 1000 * 60 * 5),
			},
			{
				userId: user1.id,
				sessionId: "session_001",
				eventType: "product_click",
				productId: products[0].id,
				payload: {},
				createdAt: new Date(now.getTime() - 1000 * 60 * 4),
			},
			{
				userId: user2.id,
				sessionId: "session_002",
				eventType: "search",
				productId: null,
				payload: { query: "running shoes" },
				createdAt: new Date(now.getTime() - 1000 * 60 * 3),
			},
			{
				userId: user2.id,
				sessionId: "session_002",
				eventType: "product_view",
				productId: products[0].id,
				payload: {
					time_spent_ms: 15000,
					scroll_depth: 0.5,
					price_seen: 8500,
				},
				createdAt: new Date(now.getTime() - 1000 * 60 * 2),
			},
			{
				userId: user3.id,
				sessionId: "session_003",
				eventType: "product_view",
				productId: products[2].id,
				payload: {
					time_spent_ms: 8000,
					scroll_depth: 0.3,
					price_seen: 2500,
				},
				createdAt: now,
			},
		],
	});

	console.log("✅ Created events");
	console.log("🎉 Database seeded successfully!");
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
