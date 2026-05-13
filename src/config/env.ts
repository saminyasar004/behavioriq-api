/**
 * Runtime configuration sourced only from environment variables
 * documented in `.env.example` (no hardcoded service URLs).
 */
export type AppConfig = {
	databaseUrl: string;
	redisUrl: string;
	mlServiceUrl: string;
	geminiApiKey: string | undefined;
	port: number;
	nodeEnv: string;
};

function required(name: keyof NodeJS.ProcessEnv): string {
	const v = process.env[name];
	if (!v?.trim()) {
		throw new Error(`Missing required environment variable: ${String(name)}`);
	}
	return v.trim();
}

function optional(name: keyof NodeJS.ProcessEnv): string | undefined {
	const v = process.env[name];
	return v?.trim() || undefined;
}

/**
 * Loads and validates env. Call once at process startup.
 * Uses DATABASE_URL, REDIS_URL, ML_SERVICE_URL, GEMINI_AI_API_KEY, PORT, NODE_ENV
 * as defined in `.env.example`.
 */
export function getConfig(): AppConfig {
	return {
		databaseUrl: required("DATABASE_URL"),
		redisUrl: required("REDIS_URL"),
		mlServiceUrl: required("ML_SERVICE_URL"),
		geminiApiKey: optional("GEMINI_AI_API_KEY"),
		port: parseInt(process.env.PORT || "5000", 10),
		nodeEnv: process.env.NODE_ENV || "development",
	};
}
