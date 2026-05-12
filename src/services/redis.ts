import { createClient, RedisClientType } from "redis";

let redisClient: RedisClientType | null = null;

export async function initializeRedis(): Promise<RedisClientType> {
	if (redisClient) return redisClient;

	const url = process.env.REDIS_URL;

	if (!url) {
		throw new Error("REDIS_URL is not defined in environment variables");
	}

	redisClient = createClient({ url });

	redisClient.on("error", (err) => console.error("Redis Client Error", err));
	redisClient.on("connect", () => console.log("✅ Redis connected"));

	await redisClient.connect();
	return redisClient;
}

export function getRedisClient(): RedisClientType {
	if (!redisClient) {
		throw new Error(
			"Redis client not initialized. Call initializeRedis() first.",
		);
	}
	return redisClient;
}

export async function cacheSet<T>(
	key: string,
	value: T,
	ttlSeconds: number = 1800,
): Promise<void> {
	const client = getRedisClient();
	await client.setEx(key, ttlSeconds, JSON.stringify(value));
}

export async function cacheGet<T>(key: string): Promise<T | null> {
	const client = getRedisClient();
	const data = await client.get(key);
	if (!data) return null;
	return JSON.parse(data) as T;
}

export async function cacheDelete(key: string): Promise<void> {
	const client = getRedisClient();
	await client.del(key);
}

export const CACHE_KEYS = {
	userProfile: (userId: string) => `user:${userId}:profile`,
	productVector: (productId: string) => `product:${productId}:vector`,
	explanation: (type: string, band: string) => `explanation:${type}:${band}`,
};
