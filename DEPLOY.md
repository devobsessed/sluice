# Sluice -- Production Deployment Guide

A step-by-step checklist for deploying Sluice to Vercel with a Neon PostgreSQL database.

---

## Prerequisites

- [ ] GitHub repository accessible (DevObsessed org or personal)
- [ ] Vercel account with **Pro plan** (required for 60-second function timeout on heavy routes)
- [ ] Neon account at [neon.tech](https://neon.tech) (free tier works for single-user)
- [ ] Anthropic API key from [console.anthropic.com](https://console.anthropic.com)
- [ ] Domain name (optional -- Vercel provides a `.vercel.app` subdomain by default)

### Why Vercel Pro?

Sluice has 9 API routes that export `maxDuration = 60` for long-running operations:
- `/api/search` -- hybrid RAG search with embedding generation
- `/api/agent/stream` -- Claude insight streaming via SSE
- `/api/cron/check-feeds` -- RSS feed checking across channels
- `/api/cron/process-jobs` -- job queue processing
- `/api/personas` -- persona generation with Claude
- `/api/personas/[id]/query` -- persona chat
- `/api/personas/ensemble` -- multi-persona streaming
- `/api/videos/[id]/embed` -- embedding pipeline
- `/api/graph/backfill` -- graph relationship building
- `/api/mcp/[transport]` -- MCP tool execution

Vercel Hobby plan limits functions to 10 seconds. These routes will timeout on Hobby.

---

## 1. Create Vercel Project

- [ ] Go to [vercel.com/new](https://vercel.com/new)
- [ ] Import the Sluice repository from GitHub
- [ ] Framework Preset: **Next.js** (auto-detected)
- [ ] Root Directory: `.` (default -- Sluice is not in a monorepo subdirectory)
- [ ] Build Command: `npm run build` (default)
- [ ] Output Directory: `.next` (default)
- [ ] Install Command: `npm install` (default)
- [ ] **Do NOT deploy yet** -- configure environment variables first (Section 3)

---

## 2. Provision Neon PostgreSQL Database

### Create Database

- [ ] Go to [console.neon.tech](https://console.neon.tech)
- [ ] Create a new project (name: `sluice` or similar)
- [ ] Region: choose closest to your Vercel deployment region (default: `us-east-1`)
- [ ] Copy the connection string -- it looks like:
  ```
  postgresql://neondb_owner:PASSWORD@ep-XXXXX.us-east-2.aws.neon.tech/neondb?sslmode=verify-full
  ```

### Enable pgvector Extension

Sluice uses pgvector for 384-dimensional vector embeddings (all-MiniLM-L6-v2 model).

- [ ] Open the Neon SQL Editor (or connect via `psql`)
- [ ] Run:
  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;
  ```
- [ ] Verify it installed:
  ```sql
  SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
  ```
  Expected: one row with `extname = vector`

### Push Schema

- [ ] From your local machine, set `DATABASE_URL` to the Neon connection string:
  ```bash
  DATABASE_URL="postgresql://neondb_owner:PASSWORD@ep-XXXXX.us-east-2.aws.neon.tech/neondb?sslmode=verify-full" npm run db:push
  ```
- [ ] Drizzle will create all 11 tables: `videos`, `channels`, `insights`, `settings`, `chunks`, `relationships`, `temporal_metadata`, `jobs`, `focus_areas`, `video_focus_areas`, `personas`
- [ ] Verify with Drizzle Studio or SQL Editor:
  ```sql
  SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
  ```

> **Troubleshooting:** If `db:push` fails with SSL errors, ensure your connection string includes `?sslmode=verify-full`. The Sluice DB module auto-detects Neon URLs (checks for `neon.tech` in the connection string) and configures SSL + reduced pool size (3 connections instead of 10).

---

## 3. Configure Environment Variables

In the Vercel dashboard, go to **Settings > Environment Variables** for your project. Add each variable for the **Production** environment.

### Required

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | `postgresql://...@...neon.tech/...?sslmode=verify-full` | Your Neon connection string from Section 2. Pool auto-sizes to 3 connections for Neon. |
| `AI_GATEWAY_KEY` | `sk-ant-...` | AI gateway key for insights, personas, ensemble queries. Get at [console.anthropic.com](https://console.anthropic.com). |
| `AGENT_AUTH_TOKEN` | Any secure random string (e.g., `openssl rand -hex 32`) | Authenticates SSE agent transport in production. When this is set, the `/api/agent/token` endpoint returns `transport: 'sse'` instead of `transport: 'websocket'`. |
| `CRON_SECRET` | Any secure random string (e.g., `openssl rand -hex 32`) | Secures `/api/cron/*` endpoints. Vercel sends this as `Authorization: Bearer <token>` header. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | Signing key for auth sessions/tokens. Required for production security. |
| `BETTER_AUTH_URL` | `https://your-domain.vercel.app` | Base URL for OAuth callback redirects. Must match your production domain exactly. |
| `GOOGLE_CLIENT_ID` | `xxx.apps.googleusercontent.com` | Google OAuth client ID. Create at Google Cloud Console. Add callback URL: `https://your-domain.vercel.app/api/auth/callback/google` |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-xxx` | Google OAuth client secret from the same credential. |

### Optional

| Variable | Value | Notes |
|----------|-------|-------|
| `MCP_AUTH_ENABLED` | `true` | Enable MCP endpoint authentication. Default: `false` (open access). |
| `MCP_AUTH_TOKEN` | Any secure random string | Required when `MCP_AUTH_ENABLED=true`. Clients send as `Authorization: Bearer <token>`. |
| `NEXT_PUBLIC_AGENT_PORT` | `9334` | Only relevant for local dev (WebSocket agent). Not used in production (SSE transport). Can be omitted. |
| `ALLOWED_EMAIL_DOMAIN` | `devobsessed.com` | Email domain restriction for sign-in. Default: `devobsessed.com`. |
| `ENABLE_AUTO_FETCH` | `true` | Gates the check-feeds cron. When not `true`, the cron returns immediately without querying the database or dispatching workflows. Leave unset to disable auto-fetch. |

> **Note:** Do NOT set `PORT` or `AGENT_PORT` -- these are local dev settings. Vercel manages ports automatically.

> **Security:** Generate tokens with `openssl rand -hex 32` for cryptographic randomness. Do not reuse tokens across variables.

---

## 4. Deploy

- [ ] In the Vercel dashboard, trigger the first deployment:
  - If you skipped the initial deploy in Section 1: click **Deploy** now
  - If it already deployed (with missing env vars): go to **Deployments**, click the latest, and **Redeploy** (check "Use existing Build Cache" = OFF for a clean build)
- [ ] Watch the build logs for:
  - `npm install` completing without errors
  - `next build` completing successfully
  - No warnings about missing environment variables in build output
- [ ] Verify the deployment URL works (e.g., `https://sluice-xxx.vercel.app`)
- [ ] Check the Function logs (Vercel dashboard > Logs) for startup -- you should NOT see:
  - `Warning: AI_GATEWAY_KEY not set` (means env var is missing)
  - `Warning: CRON_SECRET not set` (means cron endpoints are unsecured)

> **Troubleshooting: Build fails with ONNX errors**
> The embedding pipeline uses `@huggingface/transformers` which downloads the model at runtime to `/tmp/.cache`. If the build itself tries to import this during static page generation, it may fail. All embedding-using routes are API routes (not pages), so this should not happen. If it does, check that no page component imports from `@/lib/embeddings/` directly.

> **Troubleshooting: Function timeout on first request**
> The first request to an embedding route (search, embed) downloads the ~23MB all-MiniLM-L6-v2 model to `/tmp/.cache`. This cold start can take 10-15 seconds. Subsequent requests reuse the cached model (within the same serverless function instance). This is normal.

---

## 5. Domain Configuration (Optional)

Skip this section if the default `*.vercel.app` domain is sufficient.

- [ ] Go to Vercel dashboard > **Settings > Domains**
- [ ] Add your custom domain (e.g., `goldminer.yourdomain.com`)
- [ ] Configure DNS at your domain registrar:
  - **CNAME record:** `goldminer` -> `cname.vercel-dns.com`
  - OR for apex domain: **A record** -> `76.76.21.21`
- [ ] Wait for DNS propagation (usually 1-5 minutes, can take up to 48 hours)
- [ ] Vercel auto-provisions SSL certificate via Let's Encrypt
- [ ] Verify HTTPS works: `https://goldminer.yourdomain.com`

---

## 6. Verify Cron Jobs

Sluice uses one Vercel Cron Job defined in `vercel.json`:

| Cron Job | Schedule | Path | Purpose |
|----------|----------|------|---------|
| Check Feeds | Every 12 hours (`0 */12 * * *`) | `/api/cron/check-feeds` | Polls RSS feeds for new videos, dispatches [Vercel Workflows](docs/vercel-workflows.md) per video |

> **Note:** Job processing (embedding generation, AI insights) is handled by [Vercel Workflows](docs/vercel-workflows.md), which provide durable execution with automatic retry. No separate `process-jobs` cron is needed.

- [ ] Go to Vercel dashboard > **Settings > Cron Jobs**
- [ ] Verify the `check-feeds` cron job appears with the correct schedule
- [ ] Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` header to cron endpoints
- [ ] To manually trigger the cron job for testing:
  ```bash
  curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-domain.vercel.app/api/cron/check-feeds
  ```
- [ ] Expected response: `{"checked": 0, "queued": 0}` (0 channels followed initially)

> **Note:** Vercel Cron Jobs require the Pro plan. On Hobby, crons run at most once per day. On Pro, the minimum interval is 1 minute.

---

## 7. End-to-End Verification

Work through each feature to confirm the production deployment is fully functional.

### 7.1 Video Ingestion

- [ ] Navigate to `/add`
- [ ] Paste a YouTube URL (e.g., `https://www.youtube.com/watch?v=dQw4w9WgXcQ`)
- [ ] Verify video preview loads (thumbnail, title, channel from oEmbed)
- [ ] Paste a transcript and click "Add to Knowledge Bank"
- [ ] Verify success state with video thumbnail
- [ ] Verify video appears in Knowledge Bank (`/`)

### 7.2 Embedding Generation

- [ ] Navigate to the video detail page (`/videos/[id]`)
- [ ] Embeddings generate automatically after video creation (via Vercel Workflows in production, or `after()` hook locally)
- [ ] Alternatively, check via API:
  ```bash
  curl https://your-domain.vercel.app/api/videos/VIDEO_ID/embed
  ```
- [ ] Verify chunks exist in database (Neon SQL Editor):
  ```sql
  SELECT count(*) FROM chunks WHERE video_id = VIDEO_ID;
  ```

> **Note:** First embedding request triggers model download (~23MB) to `/tmp/.cache`. Allow 15-30 seconds for cold start.

### 7.3 Hybrid Search

- [ ] Go to Knowledge Bank (`/`)
- [ ] Type a search query in the search bar
- [ ] Verify results appear (requires at least one video with embeddings)
- [ ] Results should show video cards with relevant chunk previews
- [ ] Verify search works via API:
  ```bash
  curl "https://your-domain.vercel.app/api/search?q=your+query&mode=hybrid"
  ```

### 7.4 AI Insights Generation

- [ ] Navigate to a video detail page (`/videos/[id]`)
- [ ] Click the **Insights** tab
- [ ] Click **Generate** on any insight card (Extract Insights, Summarize, or Suggest Plugins)
- [ ] Verify streaming text appears in real-time (SSE transport)
- [ ] Verify the insight persists after page refresh

> **Requires:** `AI_GATEWAY_KEY` and `AGENT_AUTH_TOKEN` both set correctly. If insights fail, check Vercel Function logs for auth errors.

### 7.5 Discovery and Channel Following

- [ ] Navigate to `/discovery`
- [ ] Click "Follow a Channel"
- [ ] Paste a YouTube channel URL (e.g., `https://www.youtube.com/@fireship`)
- [ ] Verify channel appears with recent videos
- [ ] Verify "Add to Bank" button works on discovery cards

### 7.6 Persona Queries (if applicable)

Personas require 30+ videos from a single channel. Skip if you do not have enough content yet.

- [ ] Navigate to Knowledge Bank
- [ ] Persona UI appears above search results if personas exist
- [ ] Click a persona to open chat
- [ ] Send a question and verify streaming response
- [ ] Verify response references the creator's actual content/expertise

### 7.7 Ensemble SSE Streaming (if applicable)

Requires multiple personas. Skip if fewer than 2 personas exist.

- [ ] In the persona UI, click "Ask the Panel"
- [ ] Type a question and submit
- [ ] Verify responses stream from multiple personas simultaneously
- [ ] Verify `all_done` event fires (responses complete cleanly, no hanging spinners)
- [ ] Test via API:
  ```bash
  curl -X POST https://your-domain.vercel.app/api/personas/ensemble \
    -H "Content-Type: application/json" \
    -d '{"question": "What is the best way to learn programming?"}'
  ```

### 7.8 MCP Tools

Test MCP endpoints if you use Sluice with Claude Code.

- [ ] Test search_rag tool:
  ```bash
  curl -X POST https://your-domain.vercel.app/api/mcp/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'
  ```
- [ ] Verify response lists 4 tools: `search_rag`, `get_list_of_creators`, `chat_with_persona`, `ensemble_query`
- [ ] If `MCP_AUTH_ENABLED=true`, include auth header:
  ```bash
  -H "Authorization: Bearer YOUR_MCP_AUTH_TOKEN"
  ```

### 7.9 Cron Jobs (End-to-End)

- [ ] Follow at least one channel with auto-fetch enabled (via Discovery page)
- [ ] Manually trigger check-feeds:
  ```bash
  curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
    https://your-domain.vercel.app/api/cron/check-feeds
  ```
- [ ] Verify response shows `"checked": 1` (or however many channels you follow)
- [ ] If new videos were found, trigger process-jobs:
  ```bash
  curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
    https://your-domain.vercel.app/api/cron/process-jobs
  ```
- [ ] Verify jobs process (transcripts fetched, embeddings generated)

---

## Quick Reference

### Environment Variables Summary

| Variable | Required | Used For |
|----------|----------|----------|
| `DATABASE_URL` | Yes | PostgreSQL connection (Neon) |
| `AI_GATEWAY_KEY` | Yes | AI gateway key for AI features |
| `AGENT_AUTH_TOKEN` | Yes | SSE agent authentication |
| `CRON_SECRET` | Yes | Cron endpoint security |
| `BETTER_AUTH_SECRET` | Yes | Auth session/token signing key |
| `BETTER_AUTH_URL` | Yes | Base URL for OAuth redirects |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `MCP_AUTH_ENABLED` | No | MCP endpoint auth toggle |
| `MCP_AUTH_TOKEN` | No | MCP auth token (when enabled) |
| `ALLOWED_EMAIL_DOMAIN` | No | Email domain restriction (default: `devobsessed.com`) |

### Key URLs

| Path | Purpose |
|------|---------|
| `/` | Knowledge Bank (main page) |
| `/add` | Add YouTube video |
| `/add-transcript` | Upload raw transcript |
| `/discovery` | Channel discovery |
| `/videos/[id]` | Video detail + insights |
| `/settings` | User settings |
| `/api/mcp/mcp` | MCP streamable HTTP endpoint |
| `/api/mcp/sse` | MCP SSE endpoint |
| `/api/agent/token` | Agent transport detection |
| `/api/cron/check-feeds` | RSS feed checker (cron) |
| `/api/cron/process-jobs` | Job queue processor (cron) |

### Architecture Notes

- **Agent transport:** Auto-detects based on environment. If `AGENT_AUTH_TOKEN` env var is set, uses SSE via `/api/agent/stream`. If `.agent-token` file exists (local dev only), uses WebSocket on port 9334.
- **Workflows:** Durable async processing via [Vercel Workflows](docs/vercel-workflows.md). Two workflows: `embeddingsWorkflow` (triggered on video add) and `rssFeedWorkflow` (triggered by RSS discovery). Each step retries independently (3 attempts). Replaces the old job queue for production pipeline processing.
- **DB pool:** Auto-sizes based on `DATABASE_URL`. Neon URLs (`neon.tech`) get 3 connections with 10s idle timeout. Local PostgreSQL gets 10 connections with 30s idle timeout.
- **Embeddings:** Model downloads to `/tmp/.cache` on first use (~23MB). Cached within the serverless function instance lifetime. Cold starts take 10-15 seconds.
- **Cron:** Vercel automatically sends `CRON_SECRET` as `Authorization: Bearer` header to cron endpoints.
