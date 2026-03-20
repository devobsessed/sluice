# Getting Started with Sluice

A step-by-step guide to getting Sluice running on your local machine. Every step is explained so you understand what's happening and can troubleshoot if something goes wrong.

---

## Prerequisites

| Requirement | Version | How to Install | How to Verify |
|-------------|---------|----------------|---------------|
| **Node.js** | 20+ | `brew install node` or [nodejs.org](https://nodejs.org/) | `node --version` |
| **Docker** | Any recent | [docker.com](https://www.docker.com/) | `docker --version` |
| **npm** | 10+ | Comes with Node.js | `npm --version` |
| **Git** | Any recent | `brew install git` or [git-scm.com](https://git-scm.com/) | `git --version` |

**Optional for AI features:**
- **Anthropic API key** — Required for insights generation, personas, and ensemble queries. Get one at [console.anthropic.com](https://console.anthropic.com/). Without it, you can still ingest videos, generate embeddings, and search — all AI features degrade gracefully to disabled state.

---

## Quick Setup

If you just want to get running fast:

```bash
git clone https://github.com/yourusername/gold-miner.git && cd gold-miner
docker compose up -d
cp .env.example .env
npm install
npm run db:push
npm run dev
```

Open [http://localhost:3001](http://localhost:3001). Done.

The rest of this guide explains what each step does and how to troubleshoot if something goes wrong.

---

## Step-by-Step Setup

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/gold-miner.git
cd gold-miner
```

The repo name is `gold-miner` (the original project codename). The app itself is called Sluice.

### 2. Start PostgreSQL with pgvector

Sluice uses PostgreSQL 16 with the [pgvector](https://github.com/pgvector/pgvector) extension for storing 384-dimensional vector embeddings. The `docker-compose.yml` at the project root handles everything:

```bash
docker compose up -d
```

This starts a PostgreSQL container with:
- **Container name:** `goldminer-db`
- **Host:** `localhost:5432`
- **Database:** `goldminer`
- **User/Password:** `goldminer` / `goldminer`
- **pgvector:** Auto-enabled via `scripts/init-db.sql` (runs on first container creation only)
- **Health check:** `pg_isready` every 5 seconds, 5 retries

Verify it's running:

```bash
docker compose ps
# Should show:
# NAME            STATUS          PORTS
# goldminer-db    Up (healthy)    0.0.0.0:5432->5432/tcp
```

Wait for the status to show "healthy" before proceeding. The health check ensures PostgreSQL is ready to accept connections.

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

The defaults work for local development with Docker. The `.env.example` file (see [`.env.example`](../.env.example)) documents every variable with inline comments.

Here's what each variable does:

| Variable | Default | Required? | What It Does |
|----------|---------|-----------|-------------|
| `DATABASE_URL` | `postgresql://goldminer:goldminer@localhost:5432/goldminer` | Yes | PostgreSQL connection string. Matches Docker defaults — no changes needed for local dev. |
| `AI_GATEWAY_KEY` | (commented out) | No | Anthropic API key for AI features. Without it, video ingestion and search still work. |
| `NEXT_PUBLIC_AGENT_PORT` | `9334` | Yes | Agent WebSocket port for Claude Agent SDK communication. |
| `CRON_SECRET` | (commented out) | No (local) | Secures `/api/cron/*` endpoints. Only needed for production. |
| `AGENT_AUTH_TOKEN` | (commented out) | No (local) | Enables SSE agent transport. Local dev uses `.agent-token` file instead. |

**How the app validates environment at startup:**
- Missing `DATABASE_URL` → throws error (app won't start)
- Missing `AI_GATEWAY_KEY` → warns in console (AI features disabled, everything else works)
- Missing `CRON_SECRET` → warns in console (cron endpoints unsecured, fine for local dev)

**To enable AI features**, uncomment and set `AI_GATEWAY_KEY`:
```bash
AI_GATEWAY_KEY=sk-ant-your-key-here
```

### 4. Install Dependencies

```bash
npm install
```

This installs all packages including:
- **Next.js 16** and **React 19** — Framework and UI
- **Drizzle ORM** — Database queries and schema management
- **@huggingface/transformers** — ONNX runtime for local embeddings (all-MiniLM-L6-v2 model)
- **@modelcontextprotocol/sdk** — MCP protocol for Claude Code integration
- **@anthropic-ai/claude-agent-sdk** — WebSocket agent server

### 5. Initialize the Database

```bash
npm run db:push
```

Drizzle ORM creates all tables with proper indexes, foreign keys, and cascade deletes. No manual SQL needed. The schema is defined in [`src/lib/db/schema.ts`](../src/lib/db/schema.ts).

**Core tables created:**

| Table | Purpose |
|-------|---------|
| `videos` | YouTube video metadata and transcripts |
| `chunks` | Transcript chunks with 384-dim vector embeddings |
| `insights` | AI extraction results (JSONB) |
| `relationships` | Graph RAG chunk-to-chunk similarity edges |
| `temporal_metadata` | Version mentions for temporal decay ranking |
| `channels` | Followed YouTube channels with RSS feeds |
| `discovery_videos` | Cached RSS feed videos for Discovery page |
| `personas` | AI-generated personas with expertise embeddings |
| `focus_areas` | User-defined categories |
| `video_focus_areas` | Many-to-many junction: videos to focus areas |
| `jobs` | Database-backed job queue with retry logic |
| `settings` | Key-value store for user preferences |

Plus authentication tables managed by Better Auth (user, session, account, verification) and OAuth tables for MCP auth.

### 6. Start Development Servers

```bash
npm run dev
```

This starts two servers concurrently (via the `concurrently` package):

- **Next.js dev server** on [http://localhost:3001](http://localhost:3001) — UI and all API routes
- **Agent WebSocket server** on port `9334` — Claude Agent SDK communication for insight streaming

The `dev` script also runs `dev:cleanup` first, which kills any stale processes on ports 3001 and 9334 and removes the `.next/dev/lock` file.

Open [http://localhost:3001](http://localhost:3001) and you should see the Knowledge Bank page (empty state).

**Important:** Do NOT kill processes on ports **3000** or **9333** — those may belong to other projects running on the same machine.

---

## First Steps After Setup

### Add Your First Video

1. Click **Add Video** in the navigation
2. Paste a YouTube URL (e.g., `https://www.youtube.com/watch?v=dQw4w9WgXcQ`)
3. The video preview loads automatically (thumbnail, title, channel from oEmbed)
4. Paste the transcript into the transcript field
5. Click **Add to Knowledge Bank**

Embeddings generate automatically in the background via the job queue. After a few seconds (10-15 seconds on first run due to ONNX model download), the video becomes searchable.

### Try a Search

Go to the Knowledge Bank (home page) and type a query in the search bar. Hybrid search combines vector similarity and keyword matching — you'll see results even with just one video. Results show as video cards with the most relevant transcript chunk preview.

### Generate AI Insights (requires API key)

Navigate to a video's detail page (`/videos/[id]`) and click the **Insights** tab. Click **Generate** on any insight card to stream AI-extracted content: summary, key insights, action items, and plugin suggestions.

### Connect to Claude Code (Optional)

Add Sluice as an MCP server in your Claude Code configuration. See the [MCP Tools Reference](mcp-tools.md) for full setup instructions.

**Quick version — add to `.mcp.json` in any project root:**
```json
{
  "mcpServers": {
    "sluice": {
      "type": "sse",
      "url": "http://localhost:3001/api/mcp/sse"
    }
  }
}
```

Now Claude Code can search your knowledge bank, query personas, and pull context from your video library.

---

## Troubleshooting

### Docker: "port 5432 already in use"

Another PostgreSQL instance is using port 5432.

```bash
# Find what's using the port
lsof -i :5432

# Option 1: Stop the other PostgreSQL
brew services stop postgresql@17

# Option 2: Change Sluice's port in docker-compose.yml
# Change "5432:5432" to "5433:5432"
# Then update DATABASE_URL in .env to use port 5433
```

### Docker: "goldminer-db is unhealthy"

The PostgreSQL container failed its health check.

```bash
# Check logs for error details
docker compose logs postgres

# Common fix: remove stale volume and restart clean
docker compose down -v
docker compose up -d
```

### pgvector: "extension vector does not exist"

The `scripts/init-db.sql` script only runs on first container creation. If you created the container before the script existed:

```bash
# Enable pgvector manually
docker compose exec postgres psql -U goldminer -d goldminer -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Next.js: "port 3001 already in use"

A stale dev server process is hanging. The `dev:cleanup` script usually handles this, but if it doesn't:

```bash
# Clean up stale processes and lock file
npm run dev:cleanup

# Then start fresh
npm run dev
```

**Important:** Do NOT kill processes on ports **3000** or **9333** — those may belong to other projects.

### Embeddings: "Failed to initialize embedding pipeline"

The ONNX model download failed or the cache is corrupted.

```bash
# Clear the model cache
rm -rf /tmp/.cache/Xenova

# The model re-downloads automatically on next search (~23MB, 10-15 seconds)
```

This can happen if a previous download was interrupted (e.g., lost network during first startup). The pipeline (see [`src/lib/embeddings/pipeline.ts`](../src/lib/embeddings/pipeline.ts)) automatically detects corruption and retries once before throwing.

### db:push: "connection refused"

PostgreSQL isn't running.

```bash
# Check Docker status
docker compose ps

# If not running:
docker compose up -d

# Wait for health check to pass (5-10 seconds)
docker compose ps   # Should show "healthy"

# Then retry
npm run db:push
```

### db:push: SSL errors with Neon

If using a Neon database (production), ensure your connection string includes `?sslmode=require`:

```
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require
```

The Sluice DB module (see [`src/lib/db/index.ts`](../src/lib/db/index.ts)) auto-detects Neon URLs and configures SSL + reduced pool size (3 connections instead of 10).

### First search returns no results

Embeddings may not have finished generating yet. Check:

1. Does the video have a transcript? (Check the Transcript tab on the video detail page)
2. Have embeddings been generated? The search response includes `hasEmbeddings: false` if no embeddings exist yet
3. On first run, the ONNX model takes 10-15 seconds to download before embeddings can generate

---

## What's Next

- **[Core Concepts](core-concepts.md)** — Understand how Sluice's search, embeddings, and personas work under the hood
- **[Vercel Workflows](vercel-workflows.md)** — How durable async processing works in production
- **[MCP Tools Reference](mcp-tools.md)** — Connect Sluice to Claude Code and use all 4 MCP tools
- **[Search Guide](search-guide.md)** — Get better results from hybrid search
- **[Deployment](../DEPLOY.md)** — Deploy Sluice to Vercel with Neon PostgreSQL
- **[Contributing](../CONTRIBUTING.md)** — Code style, testing, and PR process
