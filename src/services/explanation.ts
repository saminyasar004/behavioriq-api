import { GoogleGenerativeAI } from "@google/generative-ai";

export type ExplanationDecision =
	| {
			decision_type: "pricing";
			intent_score: number;
			churn_probability?: number;
			original_price?: number;
			offered_price?: number;
			discount_pct?: number;
	  }
	| {
			decision_type: "churn";
			intent_score: number;
			churn_probability?: number;
			days_since_purchase?: number;
	  }
	| {
			decision_type: "search";
			intent_score: number;
			query?: string;
	  };

let genAI: GoogleGenerativeAI | null = null;

export function initExplanationClient(apiKey: string | undefined): void {
	genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
}

export async function generateExplanation(
	decision: ExplanationDecision,
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

function buildExplanationPrompt(decision: ExplanationDecision): string {
	switch (decision.decision_type) {
		case "pricing":
			return `A user with intent score ${decision.intent_score.toFixed(0)} is being offered a product at $${decision.offered_price?.toFixed(2)} (original price: $${decision.original_price?.toFixed(2)}, discount: ${decision.discount_pct?.toFixed(0)}%). Explain the pricing decision briefly based on their behavior.`;

		case "churn":
			return `A user has a churn risk of ${((decision.churn_probability || 0) * 100).toFixed(0)}%. They last purchased ${decision.days_since_purchase ?? "many"} days ago. Explain why they're at risk and what the recommended win-back action is.`;

		case "search":
			return `Search results for "${decision.query}" have been personalized for a user with intent score ${decision.intent_score.toFixed(0)}. Explain why these specific products are being prioritized.`;

		default:
			return "Explain this decision.";
	}
}

function getGenericExplanation(decision: ExplanationDecision): string {
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
			return `Customer hasn't purchased in ${decision.days_since_purchase ?? "many"} days. Churn risk is ${((decision.churn_probability || 0) * 100).toFixed(0)}%. Recommend a win-back offer.`;

		case "search":
			return `Results personalized based on your browsing patterns and high interest in specific categories.`;

		default:
			return "Decision based on behavioral profile analysis.";
	}
}
