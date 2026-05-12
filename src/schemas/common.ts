import { z } from "@hono/zod-openapi";

export const ErrorResponseSchema = z
	.object({
		error: z.string().openapi({ example: "Invalid request" }),
		details: z.string().optional().openapi({ example: "Missing required field" }),
	})
	.openapi("ErrorResponse");
