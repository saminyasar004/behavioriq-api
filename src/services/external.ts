import { GoogleGenerativeAI } from "@google/generative-ai";
import { cacheGet, cacheSet, CACHE_KEYS } from "./redis";

interface FeatureScores {
	product_visit_count: number;
	time_on_product_page: number;
	cart_add_events: number;
	scroll_depth: number;
	avg_spend_score: number;
	session_recency: number;
}

interface RFMData {
	days_since_last_purchase: number;
	total_order_count: number;
	avg_order_value: number;
}

interface RankedProduct {
	id: string;
	name: string;
	basePrice: number;
	final_score: number;
}

interface DecisionPayload {
	decision_type: "pricing" | "churn" | "search";
	intent_score: number;
	churn_probability?: number;
	visit_count?: number;
	days_since_purchase?: number;
	original_price?: number;
	offered_price?: number;
	discount_pct?: number;
	query?: string;
}

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "";
const GEMINI_AI_API_KEY = process.env.GEMINI_AI_API_KEY;

const genAI = GEMINI_AI_API_KEY
	? new GoogleGenerativeAI(GEMINI_AI_API_KEY)
	: null;

export async function callMLIntentScore(
	features: FeatureScores,
): Promise<number> {
	try {
		const response = await fetch(`${ML_SERVICE_URL}/ml/intent-score`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(features),
		});

		if (!response.ok) {
			throw new Error(`ML Service error: ${response.statusText}`);
		}

		const data = (await response.json()) as { intent_score: number };
		return data.intent_score;
	} catch (error) {
		console.error("Error calling ML intent-score:", error);
		return 50; // Fallback
	}
}

export async function callMLChurnPredict(rfmData: RFMData): Promise<number> {
	try {
		const response = await fetch(`${ML_SERVICE_URL}/ml/churn-predict`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(rfmData),
		});

		if (!response.ok) {
			throw new Error(`ML Service error: ${response.statusText}`);
		}

		const data = (await response.json()) as { churn_probability: number };
		return data.churn_probability;
	} catch (error) {
		console.error("Error calling ML churn-predict:", error);
		return 0.1; // Fallback
	}
}

export async function callMLUserVector(userId: string): Promise<number[]> {
	try {
		// In a real app, we'd fetch actual product IDs viewed by the user
		// For now, we'll pass a dummy list or the ML service might handle it
		const response = await fetch(`${ML_SERVICE_URL}/ml/user-vector`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				recent_product_ids: ["prod_1", "prod_2"], // Dummy for now
				weights: [0.6, 0.4],
			}),
		});

		if (!response.ok) {
			throw new Error(`ML Service error: ${response.statusText}`);
		}

		const data = (await response.json()) as { user_vector: number[] };
		return data.user_vector;
	} catch (error) {
		console.error("Error calling ML user-vector:", error);
		return Array(1536).fill(0); // Assuming 1536 dim
	}
}

export async function callMLSearch(
	query: string,
	churnScore: number = 0,
): Promise<any[]> {
	try {
		const response = await fetch(`${ML_SERVICE_URL}/ml/search`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query,
				churn_score: churnScore,
				top_k: 20,
			}),
		});

		if (!response.ok) {
			throw new Error(`ML Service error: ${response.statusText}`);
		}

		const data = (await response.json()) as { results: any[] };
		return data.results;
	} catch (error) {
		console.error("Error calling ML search:", error);
		throw error;
	}
}

export async function generateExplanation(
	decision: DecisionPayload,
): Promise<string> {
	if (!genAI) {
		return getGenericExplanation(decision);
	}

	try {
		const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
		const prompt = buildExplanationPrompt(decision);

		const systemInstruction = `You are a commerce intelligence assistant for an SME platform.
Generate a clear, concise business explanation (2-3 sentences) for a pricing or search decision.
Be specific with numbers. Write for non-technical SME owners. Output plain text only.`;

		const result = await model.generateContent(
			`${systemInstruction}\n\nDecision Data: ${prompt}`,
		);
		const response = await result.response;
		const text = response.text();

		return text || getGenericExplanation(decision);
	} catch (error) {
		console.error("Error generating explanation with Gemini:", error);
		return getGenericExplanation(decision);
	}
}

function buildExplanationPrompt(decision: DecisionPayload): string {
	switch (decision.decision_type) {
		case "pricing":
			return `A user with intent score ${decision.intent_score.toFixed(0)} is being offered a product at $${decision.offered_price?.toFixed(2)} (original price: $${decision.original_price?.toFixed(2)}, discount: ${decision.discount_pct?.toFixed(0)}%). Explain the pricing decision briefly based on their behavior.`;

		case "churn":
			return `A user has a churn risk of ${((decision.churn_probability || 0) * 100).toFixed(0)}%. They last purchased ${decision.days_since_purchase} days ago. Explain why they're at risk and what the recommended win-back action is.`;

		case "search":
			return `Search results for "${decision.query}" have been personalized for a user with intent score ${decision.intent_score.toFixed(0)}. Explain why these specific products are being prioritized.`;

		default:
			return "Explain this decision.";
	}
}

function getGenericExplanation(decision: DecisionPayload): string {
	switch (decision.decision_type) {
		case "pricing":
			if (decision.intent_score >= 80)
				return "High intent detected. Holding standard pricing to maintain margin while the customer is ready to buy.";
			if (decision.intent_score >= 55)
				return `User showing interest but hesitating. A small ${decision.discount_pct}% nudge applied to encourage immediate conversion.`;
			if (decision.intent_score >= 30)
				return `Moderate interest level. A ${decision.discount_pct}% discount offered to move the user from browsing to the cart.`;
			return `Low intent/Churn risk. Aggressive ${decision.discount_pct}% win-back discount applied to re-engage the customer.`;

		case "churn":
			return `Customer hasn't purchased in ${decision.days_since_purchase} days. Churn risk is ${((decision.churn_probability || 0) * 100).toFixed(0)}%. Recommend a win-back offer.`;

		case "search":
			return `Results personalized based on your browsing patterns and high interest in specific categories.`;

		default:
			return "Decision based on behavioral profile analysis.";
	}
}
