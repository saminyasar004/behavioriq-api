let mlBaseUrl: string | null = null;

/** Call once at startup with `config.mlServiceUrl` from `getConfig()`. */
export function initMlClient(url: string): void {
	mlBaseUrl = url.replace(/\/$/, "");
}

function baseUrl(): string {
	if (!mlBaseUrl) {
		throw new Error("ML client not initialized (call initMlClient at startup)");
	}
	return mlBaseUrl;
}

export type MlRfmPayload = {
	days_since_last_purchase: number;
	total_order_count: number;
	avg_order_value: number;
};

/** Matches `behavioriq-ml-service` IntentRequest field names (0–1 clamped server-side). */
export type MlIntentFeatures = {
	product_visit_count: number;
	time_on_product_page: number;
	cart_add_events: number;
	scroll_depth: number;
	avg_spend_score: number;
	session_recency: number;
};

export async function callMLIntentScore(
	features: MlIntentFeatures,
): Promise<number> {
	const response = await fetch(`${baseUrl()}/ml/intent-score`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(features),
	});

	if (!response.ok) {
		throw new Error(`ML intent-score error: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as { intent_score: number };
	return data.intent_score;
}

export async function callMLChurnPredict(rfmData: MlRfmPayload): Promise<number> {
	const response = await fetch(`${baseUrl()}/ml/churn-predict`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(rfmData),
	});

	if (!response.ok) {
		throw new Error(`ML churn-predict error: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as { churn_probability: number };
	return data.churn_probability;
}

export async function callMLProductEmbed(payload: {
	product_id: string;
	name: string;
	description?: string;
	category?: string;
	brand?: string;
}): Promise<number[]> {
	const response = await fetch(`${baseUrl()}/ml/product-embed`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		throw new Error(
			`ML product-embed error: ${response.status} ${response.statusText}`,
		);
	}

	const data = (await response.json()) as {
		product_vector: number[];
	};
	return data.product_vector ?? [];
}

export async function callMLUserVector(
	recentProductIds: string[],
	weights?: number[],
): Promise<number[]> {
	const body: { recent_product_ids: string[]; weights?: number[] } = {
		recent_product_ids: recentProductIds.slice(0, 24),
	};
	if (weights?.length && weights.length === body.recent_product_ids.length) {
		body.weights = weights;
	}

	const response = await fetch(`${baseUrl()}/ml/user-vector`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		throw new Error(`ML user-vector error: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as { user_vector: number[] };
	return data.user_vector;
}

export type SearchRerankCandidate = {
	product_id: string;
	keyword_score: number;
	popularity_score?: number;
	semantic_score?: number;
	price?: number;
	category?: string;
};

export type SearchRerankResult = {
	product_id: string;
	final_score: number;
	vector_score?: number;
	cosine_score?: number;
	keyword_score?: number;
};

export async function callMLSearchRerank(payload: {
	user_vector: number[];
	candidates: SearchRerankCandidate[];
	weights?: Record<string, number>;
}): Promise<SearchRerankResult[]> {
	const response = await fetch(`${baseUrl()}/ml/search-rerank`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			user_vector: payload.user_vector,
			candidates: payload.candidates,
			weights:
				payload.weights ?? { vector: 0.5, intent: 0.3, pricing: 0.2 },
		}),
	});

	if (!response.ok) {
		throw new Error(`ML search-rerank error: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as { results: SearchRerankResult[] };
	return data.results ?? [];
}

/** Full BIQ pipeline (semantic + keyword + intent) when ML service has optional deps initialised. */
export async function callMLSearch(
	query: string,
	churnScore: number = 0,
	recentProductIds?: string[],
): Promise<unknown[]> {
	const response = await fetch(`${baseUrl()}/ml/search`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			query,
			churn_score: churnScore,
			top_k: 20,
			recent_product_ids: recentProductIds?.length ? recentProductIds : undefined,
		}),
	});

	if (!response.ok) {
		throw new Error(`ML search error: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as { results: unknown[] };
	return data.results ?? [];
}
