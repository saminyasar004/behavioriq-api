# BehaviorIQ Backend

**Standalone Hono REST API backend** for the BehaviorIQ behavioral commerce intelligence platform.

> **Note**: This is one of three independent repositories in the BehaviorIQ project:
>
> - **Backend** (this repo) — Hono API + PostgreSQL + Redis
> - **ML Service** — Python FastAPI (separate repo)
> - **Frontend (BehaviorIQ)** — Next.js React app (separate repo)

## Overview

This is the core API layer that:

- **Ingests pixel events** from the storefront via `/api/events/batch`
- **Computes behavioral profiles** (Intent Score, Churn Probability)
- **Serves personalized pricing** via `/api/pricing/:productId`
- **Handles intent-based search** via `/api/search`
- **Provides admin dashboard** endpoints via `/api/dashboard`
- **Manages real-time alerts** via WebSocket (future)

## Tech Stack

- **Framework**: Hono (lightweight, TypeScript-first web framework)
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis (for profile caching)
- **Runtime**: Node.js 20+ with TypeScript
- **Package Manager**: Yarn
- **Logging**: Morgan
- **Containerization**: Docker

## Project Structure

```
backend/
├── src/
│   ├── index.ts              # Main server entry point
│   ├── routes/
│   │   ├── events.ts         # Event ingestion endpoint
│   │   ├── pricing.ts        # Dynamic pricing logic
│   │   ├── search.ts         # Intent-based search
│   │   └── dashboard.ts      # Admin dashboard APIs
│   └── seed.ts               # Database seeding
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── migrations/           # Database migrations (auto-generated)
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml        # Backend services only (PostgreSQL, Redis)
├── .env.example
└── README.md (this file)
```

## Setup

### Prerequisites

- Node.js 20+
- Yarn
- Docker & Docker Compose
- PostgreSQL 16 (or use Docker)
- Redis (or use Docker)

### Local Development (without Docker)

1. **Install dependencies**

   ```bash
   cd backend
   yarn install
   ```

2. **Set up environment**

   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Generate Prisma client**

   ```bash
   yarn prisma:generate
   ```

4. **Run migrations**

   ```bash
   yarn prisma migrate dev
   ```

5. **Seed database with demo data**

   ```bash
   yarn prisma:seed
   ```

6. **Start dev server**
   ```bash
   yarn dev
   # Server runs on http://localhost:3000
   ```

### Docker Setup (Recommended)

Run backend services (PostgreSQL, Redis, Backend) with Docker Compose:

```bash
# From backend directory
docker-compose up --build

# Services:
# - Backend: http://localhost:3000
# - PostgreSQL: localhost:5432
# - Redis: localhost:6380
```

To seed the database:

```bash
docker-compose exec backend yarn prisma:seed
```

**Note**: This runs only the backend services. The ML Service and Next.js frontend are separate repos and should be run independently.

## Available Endpoints

### Health Check

```
GET /health
→ { status: "ok", timestamp: "..." }
```

### Event Ingestion

```
POST /api/events/batch
Body: { events: [...] }  (see PIXEL_EVENT_FORMAT.md for structure)
→ { success: true, eventsProcessed: N, message: "..." }
```

### Get Events

```
GET /api/events?userId=...&limit=10
→ { events: [...], count: N }
```

### Dynamic Pricing

```
GET /api/pricing/:productId?userId=...
→ {
    product_id,
    original_price,
    offered_price,
    discount_pct,
    reason,
    action_type
  }
```

### Intent-Based Search

```
GET /api/search?q=running%20shoes&userId=...
→ {
    results: [...],
    count: N,
    personalized: bool,
    explanation: "..."
  }
```

### Dashboard Overview

```
GET /api/dashboard/overview
→ {
    totalUsers,
    totalEvents,
    revenueLifted,
    conversionRate,
    churnAlerts
  }
```

### Churn Alerts

```
GET /api/dashboard/churn-alerts
→ { alerts: [...], count: N }
```

### Pricing Decision Log

```
GET /api/dashboard/pricing-log?limit=50
→ { decisions: [...], count: N }
```

## Database Schema

Key tables:

- **users** — Customers
- **events** — Raw pixel events (product_view, search, cart_add, etc.)
- **products** — Product catalog
- **behavioral_profiles** — Computed Intent Score, Churn Probability per user
- **pricing_decisions** — Audit log of pricing decisions with explanations
- **churn_predictions** — RFM-based churn scores
- **orders** — Purchase history (for RFM calculation)
- **search_logs** — Search analytics

See `prisma/schema.prisma` for full schema.

## Integration Points

### 1. Python ML Service (External)

The backend calls the external ML Service for:

- **Intent Score computation** (POST `/ml/intent-score`)
- **Churn prediction** (POST `/ml/churn-predict`)
- **Search re-ranking** (POST `/ml/search-rerank`)
- **User vector building** (POST `/ml/user-vector`)

Configure ML Service URL via `ML_SERVICE_URL` env var (default: `http://localhost:8000`).
The ML Service runs as a separate repo/container.

### 2. Claude API (Future)

For explaining pricing and churn decisions in plain English.

### 3. Redis

Caches behavioral profiles to avoid recomputing on every request.

- Key pattern: `user:{userId}:profile`
- TTL: 30 minutes

### 4. Pixel SDK

Receives batched events from the storefront and stores them in PostgreSQL.

## Development Workflow

### Adding New Routes

1. Create a file in `src/routes/`
2. Export a Hono app from it
3. Mount it in `src/index.ts` with `app.route()`

Example:

```typescript
// src/routes/custom.ts
export const customRoutes = new Hono<{ Variables: { prisma: PrismaClient } }>();

customRoutes.get("/endpoint", async (c) => {
	const prisma = c.get("prisma");
	// Your logic here
	return c.json({ data: "..." });
});
```

Then in `src/index.ts`:

```typescript
import { customRoutes } from "./routes/custom";
app.route("/api/custom", customRoutes);
```

### Running Migrations

```bash
# Create a new migration
yarn prisma migrate dev --name add_new_field

# Apply migrations to production database
yarn prisma migrate deploy
```

### Debugging

Enable verbose logging:

```bash
DEBUG=* yarn dev
```

### Type Checking

```bash
yarn tsc --noEmit
```

## Performance Considerations

- **Event batching**: Pixel SDK batches events every 5 seconds to reduce DB writes
- **Caching**: User profiles cached in Redis (30 min TTL) to avoid frequent recomputation
- **Database indexing**: Events and profiles indexed on userId, createdAt for fast queries
- **ML service**: Called asynchronously (non-blocking on API response)

## Common Issues

### "Cannot find module '@prisma/client'"

```bash
yarn prisma:generate
```

### Database connection refused

- Ensure PostgreSQL is running on correct host/port
- Check `DATABASE_URL` in `.env`
- If using Docker, ensure services are on same network

### Redis connection failed

- Ensure Redis is running on correct host/port
- Check `REDIS_URL` in `.env`

## Next Steps

1. Implement **Behavioral Engine Service** to compute Intent Score on event ingestion
2. Integrate with **Python ML service** for churn prediction and search re-ranking
3. Implement **pricing logic** based on Intent Score
4. Add **Claude API** integration for decision explanations
5. Add **WebSocket** support for real-time dashboard alerts

---

**Status**: Event ingestion endpoint is ready. Behavioral computation and AI integrations are next.
