# Kajola Monorepo

This repository contains the Kajola multi-tenant marketplace platform scaffold.

## Workspaces
- `apps/web` — Next.js dashboard
- `apps/mobile` — Expo mobile app
- `packages/ui` — shared UI primitives
- `packages/api` — shared API types and clients
- `packages/db` — schema helpers and migration tooling
- `packages/automation` — event automation engine
- `supabase` — Postgres migrations and edge functions

## Scripts
- `npm install`
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run typecheck`

## Getting started
1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and fill required values.
3. Start development: `npm run dev`

## Notes
This scaffold is intentionally minimal and designed to be extended with real Supabase migrations, API implementations, and UI screens.
