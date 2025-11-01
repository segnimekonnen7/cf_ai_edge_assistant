# Cloudflare Edge Assistant

Cloudflare Edge Assistant is a production-style, AI powered customer assistant that runs entirely on Cloudflare’s stack. The project combines a streaming Workers AI chat endpoint, Durable Object backed conversational memory, and a Workflows DAG that orchestrates ingestion, context assembly, LLM calls, and memory updates. A lightweight Cloudflare Pages UI provides text chat, optional voice input, and live token streaming.

## Feature Checklist

- ✅ Workers AI with configurable Llama 3.3 instruct model and SSE streaming.
- ✅ Cloudflare Workflows DAG (`ingest_input → load_memory → prepare_context → call_llm → update_memory → emit_stream`).
- ✅ Durable Object memory with rolling summary plus KV long-term snapshot.
- ✅ REST endpoints for memory export and reset (`GET/DELETE /api/memory`).
- ✅ Cloudflare Pages chat UI with voice toggle (Web Speech API) and streaming renderer.
- ✅ pnpm monorepo with scripts for dev, test, deploy, and load testing.
- ✅ MIT licensed repository with documented prompts and troubleshooting guidance.

## Architecture

```
               +---------------------------+
               |   Cloudflare Pages (Vite) |
               |  chat + voice + settings  |
               +-------------+-------------+
                             |
                             |  HTTPS + SSE
                             v
                 +-----------+-----------+
                 |  Workers API Gateway  |
                 |  apps/worker (SSE)    |
                 +-----------+-----------+
                             |
              triggers workflow + memory ops
                             v
                 +-----------+-----------+
                 |  Cloudflare Workflows |
                 | ingest → memory → llm |
                 +-----------+-----------+
                   |                     |
                   | Durable Object      | Workers AI
                   v                     v
         +---------+---------+   +-------+-------+
         | SessionMemory DO  |   | Llama 3.3 LLM  |
         | turns + summary   |   | streaming text |
         +---------+---------+   +---------------+
                   |
                   | optional KV snapshots
                   v
               +---+---+
               |  KV  |
               +-------+
```

## Quickstart

1. **Install dependencies**
   ```bash
   pnpm install
   ```
2. **Create `.dev.vars` in the repo root**
   ```bash
   CF_ACCOUNT_ID=your_account_id
   CHAT_SUMMARIES_NAMESPACE=kv_namespace_id_or_dummy
   MODEL_ID=@cf/meta/llama-3.3-8b-instruct
   ```
3. **Run locally** (Workers dev server + Pages UI + Workflows)
   ```bash
   pnpm dev
   ```
   - Worker: http://127.0.0.1:8787
   - Pages:  http://127.0.0.1:5173
   - Workflows: http://127.0.0.1:8788 (default wrangler port)
4. **Deploy**
   ```bash
   pnpm deploy
   ```

## Local Development

- `pnpm --filter @cf-ai/worker dev` runs the Worker via miniflare.
- `pnpm --filter @cf-ai/workflows dev` starts the Workflows dev loop.
- `pnpm --filter @cf-ai/web dev` serves the Vite Pages UI with a proxy to the worker.
- Adjust bindings and account IDs in `infra/*.wrangler.toml`. The scripts reference these configuration files directly.

## Testing

- Unit tests (prompt builder): `pnpm test`
- Formatting/linting: `pnpm lint`
- Load test (50 concurrent chat posts): `pnpm loadtest`

## Memory Management

- Export the current memory snapshot:
  ```bash
  curl "http://127.0.0.1:8787/api/memory?sessionId=sess_123"
  ```
- Clear a session:
  ```bash
  curl -X DELETE "http://127.0.0.1:8787/api/memory?sessionId=sess_123"
  ```

`SessionMemory` stores the last 20 turns plus a rolling summary. Every update triggers the summariser; long-term summaries are mirrored to the optional KV namespace `CHAT_SUMMARIES` when configured.

## Deployment Outputs

- Worker URL: shown after `wrangler deploy` from `infra/worker.wrangler.toml`.
- Workflows name: displayed by `wrangler workflows deploy` (`cf-ai-edge-workflow`).
- Pages deployment: `wrangler pages deploy dist` prints the preview/production URLs.

## Troubleshooting

- **Binding errors**: ensure `CF_ACCOUNT_ID`, Durable Object, KV, and Workflows bindings are set in each `infra/*.wrangler.toml`. Missing bindings will surface as `ReferenceError` during deploy.
- **Workers AI permission**: enable Workers AI in your Cloudflare dashboard and grant the Worker access. Without it, `/api/chat` falls back to a stateless handler.
- **Voice toggle disabled**: browsers without Web Speech API support show a warning in the status banner.
- **Streaming stops early**: check browser devtools for SSE parsing errors—make sure the Worker response has `Content-Type: text/event-stream` and no caches in front of it.

## Repository Layout

```
apps/
  worker/     # Chat API Worker, SSE streaming, workflow trigger
  durable/    # SessionMemory durable object
  workflows/  # Workflows DAG orchestration + tests
web/          # Cloudflare Pages chat UI (Vite + TS)
infra/        # wrangler configs for worker, durable, workflows
scripts/      # Load test helper
README.md     # This file
PROMPTS.md    # Prompt log (system, summary, etc.)
```

## Deployed URL Placeholders

- Worker: `https://<worker-subdomain>.workers.dev`
- Workflows: `https://dash.cloudflare.com/<account>/ai/workflows`
- Pages: `https://cf-ai-edge-assistant.pages.dev`

Replace `<worker-subdomain>` and `<account>` after your own deployment.

