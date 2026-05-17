import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads `.env` from cwd when present. Does not override existing `process.env` keys.
 * Avoids the `dotenv` package so seed/CLI work even if `dotenv` is absent from `node_modules`.
 */
export function loadDotenvOptional(filename = ".env"): void {
	try {
		const envPath = resolve(process.cwd(), filename);
		const content = readFileSync(envPath, "utf8");
		for (let line of content.split("\n")) {
			line = line.trim();
			if (!line || line.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq <= 0) continue;
			const key = line.slice(0, eq).trim();
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
			let val = line.slice(eq + 1).trim();
			if (
				(val.startsWith('"') && val.endsWith('"')) ||
				(val.startsWith("'") && val.endsWith("'"))
			) {
				val = val.slice(1, -1);
			}
			const cur = process.env[key];
			if (cur === undefined || cur === "") {
				process.env[key] = val;
			}
		}
	} catch {
		// no .env or unreadable — rely on real environment (Docker, CI, etc.)
	}
}
