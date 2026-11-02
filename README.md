# Shared Bill Splitter

A typed shared household expenses dashboard built for the DoCoDeGo SDE intern assignment.

## Stack

- React 19, Vite, TanStack Router, TypeScript
- Hono on Cloudflare Workers
- Cloudflare D1 (SQLite), SQL migrations
- Vitest in the Workers runtime; Biome

## Getting started

Install pnpm and Node.js, then run from the repository root:

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. The API is available at http://localhost:8787. Local migrations run as part of the API dev script. The app stores the selected home ID in your browser's localStorage. No account system or real payment transfer is implemented.

## Quality checks

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

**Verification status:** The developer's local run on 2026-11-02 reported 24/24 original tests passing, TypeScript typechecking passing, and a successful Vite production build. Biome reported formatting/import-order errors and a CSS specificity warning. A follow-up CI workflow and additional edge-case tests have since been added; these later changes still require a fresh successful CI or local run. Use `pnpm check:fix` to apply Biome's safe formatting fixes, then rerun the commands above. Original company tests were preserved.

## Architecture

```
api/
  migrations/0001_init.sql   # D1 constraints and indexes
  src/index.ts               # Hono routes + D1 queries
  test/                      # Original assessment tests (unchanged)
web/
  src/routes/index.tsx       # Dashboard: homes, members, bills, payments
  src/styles/global.css      # Responsive dashboard styling
  src/main.tsx               # TanStack Router bootstrap
```

### API routes

| Method | Path                                   | Description                        |
| ------ | -------------------------------------- | ---------------------------------- |
| GET    | /api/health                            | Health status                      |
| POST   | /api/homes                             | Create a home                      |
| POST   | /api/homes/:homeId/members             | Add a member                       |
| POST   | /api/homes/:homeId/bills               | Create and equally split a bill    |
| POST   | /api/bills/:billId/shares/:shareId/pay | Pay an individual share            |
| GET    | /api/homes/:homeId/balances            | Outstanding balances               |
| GET    | /api/homes/:homeId                     | Home plus its members (UI support) |
| GET    | /api/homes/:homeId/bills               | Bills plus shares (UI support)     |

Error responses use `{"error":"message"}`. Malformed names return HTTP 400, invalid bills return HTTP 422, unknown resources return HTTP 404, and conflicting payment keys return HTTP 409.

## Database

- **homes:** primary key, nonempty name.
- **members:** primary key, foreign key to homes, nonempty name; insertion order via SQLite rowid.
- **bills:** primary key, foreign key to homes, nonempty title, positive integer total.
- **shares:** primary key, foreign keys to bills and members, nonnegative amount, unique bill/member pair, payment-state consistency check.
- Indexes cover member, bill, share, and unpaid-member lookups.
- SQL statements always bind values rather than interpolating user input.

## Decisions

1. **Use integer cents and deterministic remainder allocation.** Every bill is divided with `Math.floor(totalCents / memberCount)` and the leftover cents are distributed one by one to members in insertion order. This avoids floating-point currency errors and guarantees the shares sum to the total.
2. **Use conditional atomic SQL updates for payment idempotency.** A payment updates a share only while `paid_at IS NULL`, saving its idempotency key at the same time. Replays with the same key return the stored timestamp; different keys conflict. This guards against duplicate state changes without an in-memory mutex.
3. **Keep the API contracts simple and add only two read endpoints for UI needs.** The assignment requires displaying bills and shares but exposes no read endpoint for them. Read-only endpoints avoid duplicating data in the browser and leave required routes unchanged.

## Important limitations and next steps

- No authentication or payment gateway (by design).
- The home ID stored in the browser is a convenience, not an access-control mechanism.
- The application requires a configured D1 database for deployment; `api/wrangler.jsonc` uses a local placeholder database ID.
- Original and hidden tests must be executed and verified before final submission.
- The provided code is a starting implementation for you to review and understand, not a claim that you personally authored it.

## How the flow works

Create a home, add members, and create a bill. The server writes a bill and its shares using D1 batch statements, allocating any remainder in membership order. A member clicks Mark paid; the server performs a conditional update using the Idempotency-Key header. The dashboard reloads bills and outstanding balances after success and displays an error without marking unpaid shares as paid if payment fails.

## Interview demonstration (under 3 minutes)

1. Show the D1 tables and their named constraints.
2. Create a home with three members and split 1000 cents (334, 333, 333).
3. Mark one share paid, retry with the same key, then explain why another key returns 409.
4. Explain that the atomic SQL predicate prevents concurrent double state changes and why integer cents avoid rounding errors.

**AI use:** AI-assisted implementation and documentation. Review, test, and explain every line before submission.
