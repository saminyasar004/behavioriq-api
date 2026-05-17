# BehaviorIQ API

Hono REST API for the BehaviorIQ behavioral commerce platform: event ingestion, behavioral profiles, dynamic pricing, intent search, dashboard analytics, and real-time Socket.IO alerts.

## Quick start

```bash
cd behavioriq-api
yarn install
cp .env.example .env
# Start PostgreSQL + Redis (or use Docker Compose below)

yarn db:generate
yarn db:push
yarn db:seed
yarn dev
```

- API: `http://127.0.0.1:5000` (see `PORT` in `.env`)
- Swagger: `http://127.0.0.1:5000/docs`
- Socket.IO dashboard namespace: `/dashboard`

### Docker Compose (recommended)

```bash
docker compose up --build
```

Runs Postgres, Redis, migrations, seed, and dev server. Set `ML_SERVICE_URL` to reach the ML container (e.g. `http://host.containers.internal:8001`).

### ML service

Start `behavioriq-ml-service` on port **8001** and set:

```env
ML_SERVICE_URL=http://localhost:8001
```

Without ML, the API falls back to local heuristics; product create/update uses a zero vector if embed fails.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/events/batch` | Pixel event ingestion |
| GET | `/api/events` | Recent events |
| GET | `/api/products` | List catalog |
| POST | `/api/products` | Create product (+ ML embed) |
| GET | `/api/products/:id` | Product detail |
| PUT | `/api/products/:id` | Update product (re-embed on text change) |
| DELETE | `/api/products/:id` | Delete if unused |
| GET | `/api/pricing/:productId?userId=` | Personalized price |
| GET | `/api/search?q=&userId=` | Intent-aware search |
| GET | `/api/dashboard/overview` | KPIs |
| GET | `/api/dashboard/live-feed` | Recent activity |
| GET | `/api/dashboard/churn-alerts` | Active churn alerts |
| PATCH | `/api/dashboard/churn-alerts/:id/resolve` | Resolve alert |
| GET | `/api/dashboard/pricing-log` | Pricing audit log |
| GET | `/api/dashboard/search-analytics` | Search metrics |
| GET | `/api/dashboard/what-if` | Discount simulator |
| GET | `/api/dashboard/users/:userId/behavior` | Persona snapshot |

OpenAPI spec: `/docs/spec`

## Real-time (Socket.IO)

Connect to the API origin with path `/socket.io`, namespace **`/dashboard`**.

Events emitted from the server:

- `churn:alert` — churn probability crossed threshold
- `intent:high` — high intent detected
- `pricing:decision` — new personalized price

## Demo seed

`yarn db:seed` creates three personas:

- `hot_buyer@example.com` — intent 87, minimal discount
- `hesitant_browser@example.com` — intent 44, ~12% nudge
- `churning_customer@example.com` — intent 21, churn 0.79, win-back

The script prints `NEXT_PUBLIC_BEHAVIORIQ_USERS_JSON` for frontend wiring.

## E2E smoke test

```bash
yarn test:e2e
# ./scripts/e2e-smoke.sh http://127.0.0.1:5000 http://127.0.0.1:8001
```

## Environment

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis for profile/explanation cache |
| `ML_SERVICE_URL` | Python ML service base URL |
| `GEMINI_AI_API_KEY` | Optional; fallback copy when unset |
| `PORT` | HTTP port (default 5000) |

## Project layout

```
src/
  index.ts          # HTTP + Socket.IO entry
  app.ts            # Hono app + routes
  routes/           # OpenAPI route modules
  services/         # Business logic
  schemas/          # Zod/OpenAPI schemas
  seed.ts           # Demo data
prisma/schema.prisma
scripts/e2e-smoke.sh
```

## Docs

- Pixel format: `PIXEL_EVENT_FORMAT.md`
- Platform architecture: `../docs/ARCHITECTURE.md`
- Demo script: `../docs/DEMO_SCRIPT.md`
