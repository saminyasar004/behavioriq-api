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

export async function callMLUserVector(_userId: string): Promise<number[]> {
	const response = await fetch(`${baseUrl()}/ml/user-vector`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			recent_product_ids: ["prod_1", "prod_2"],
			weights: [0.6, 0.4],
		}),
	});

	if (!response.ok) {
		throw new Error(`ML user-vector error: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as { user_vector: number[] };
	return data.user_vector;
}

export async function callMLSearch(
	query: string,
	churnScore: number = 0,
): Promise<unknown[]> {
	const response = await fetch(`${baseUrl()}/ml/search`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			query,
			churn_score: churnScore,
			top_k: 20,
		}),
	});

	if (!response.ok) {
		throw new Error(`ML search error: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as { results: unknown[] };
	return data.results;
}
