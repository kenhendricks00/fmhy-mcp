# FMHY MCP Server

This repository exposes the FMHY single-page dataset at `https://api.fmhy.net/single-page`.

It supports both:

- local `stdio` MCP for tools like LM Studio
- remote `Streamable HTTP` MCP on Cloudflare Workers

## What it exposes

- `fmhy_search`: keyword search across FMHY sections and entries
- `fmhy_get_section`: fetch a full section by heading or slug
- `fmhy_get_links`: find matching FMHY entries and their URLs
- `fmhy_list_sections`: list section headings for navigation
- `fmhy_refresh_cache`: force-refresh the cache

## Live hosted endpoint

The current public MCP endpoint is:

- `https://fmhy-mcp.ken.tools/mcp`

The root URL can be used as a quick status check:

- `https://fmhy-mcp.ken.tools/`

This is a `Streamable HTTP` MCP endpoint, not a normal REST API. Direct requests to `/mcp` must use MCP-compatible headers such as `Accept: text/event-stream`.

Example remote MCP config:

```json
{
  "url": "https://fmhy-mcp.ken.tools/mcp"
}
```

If you later enable bearer auth again, use:

```json
{
  "url": "https://fmhy-mcp.ken.tools/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_TOKEN"
  }
}
```

## Local `stdio` usage

This project still works as a standard local process-based MCP server.

Core launch shape:

```json
{
  "command": "node",
  "args": ["C:\\Users\\[NAME]\\fmhy-mcp\\src\\index.js"]
}
```

Install:

```powershell
npm install
```

Run:

```powershell
npm start
```

Smoke test:

```powershell
npm run smoke
```

### LM Studio setup

LM Studio supports MCP servers through its `mcp.json` file:

[LM Studio MCP docs](https://lmstudio.ai/docs/app/mcp)

```json
{
  "fmhy-mcp": {
    "command": "node",
    "args": ["C:\\Users\\[NAME]\\fmhy-mcp\\src\\index.js"]
  }
}
```

Optional environment variables:

```json
{
  "fmhy-mcp": {
    "command": "node",
    "args": ["C:\\Users\\[NAME]\\fmhy-mcp\\src\\index.js"],
    "env": {
      "FMHY_CACHE_TTL_MINUTES": "360",
      "FMHY_SOURCE_URL": "https://api.fmhy.net/single-page"
    }
  }
}
```

## Cloudflare deployment

The Worker entrypoint is [src/worker.mjs](C:/Users/hendricksk4/Downloads/fmhy-mcp/src/worker.mjs). It serves MCP over `Streamable HTTP` and uses Cloudflare KV for cache persistence.

### Cloudflare files

- [wrangler.jsonc](C:/Users/hendricksk4/Downloads/fmhy-mcp/wrangler.jsonc)
- [src/worker.mjs](C:/Users/hendricksk4/Downloads/fmhy-mcp/src/worker.mjs)
- [.dev.vars.example](C:/Users/hendricksk4/Downloads/fmhy-mcp/.dev.vars.example)

### Current Worker config

- Worker name: `fmhy-mcp`
- Custom domain: `fmhy-mcp.ken.tools`
- KV binding: `FMHY_CACHE`
- KV production namespace ID: `b789d1e93a294a1ea52bca9bc9d0b584`
- KV preview namespace ID: `fe208bd507c24d759e4c34edb13a7a04`

### One-time setup

1. Install dependencies:

```powershell
npm install
```

2. Log into Cloudflare:

```powershell
npx wrangler login
```

3. Review or update [wrangler.jsonc](C:/Users/hendricksk4/Downloads/fmhy-mcp/wrangler.jsonc) if you are deploying under a different domain or account.

4. Optional: create `.dev.vars` from [.dev.vars.example](C:/Users/hendricksk4/Downloads/fmhy-mcp/.dev.vars.example) for local Worker testing.

Recommended values:

```dotenv
ALLOWED_ORIGINS=https://fmhy-mcp.ken.tools
FMHY_SOURCE_URL=https://api.fmhy.net/single-page
FMHY_CACHE_TTL_MINUTES=360
```

5. Optional: add auth by setting a Worker secret:

```powershell
npx wrangler secret put FMHY_API_TOKEN
```

If `FMHY_API_TOKEN` is set, clients must send:

```text
Authorization: Bearer <your-token>
```

If `FMHY_API_TOKEN` is not set, the remote endpoint is public.

### Deploy

Deploy the Worker:

```powershell
npm run cf:deploy
```

After deploy, the endpoint will be:

- `https://fmhy-mcp.ken.tools/mcp`

### Local Worker dev

```powershell
npm run cf:dev
```

### Manual endpoint checks

Root health/info page:

```powershell
Invoke-WebRequest -Uri "https://fmhy-mcp.ken.tools/"
```

SSE/MCP transport check:

```powershell
$headers = @{ Accept = "text/event-stream" }
Invoke-WebRequest -Uri "https://fmhy-mcp.ken.tools/mcp" -Headers $headers -Method GET
```

If auth is enabled:

```powershell
$headers = @{
  Accept = "text/event-stream"
  Authorization = "Bearer YOUR_TOKEN"
}
Invoke-WebRequest -Uri "https://fmhy-mcp.ken.tools/mcp" -Headers $headers -Method GET
```

### Notes

- `/mcp` is an MCP transport endpoint, not a normal JSON REST route.
- If you prefer `api.ken.tools/fmhy-mcp`, update the route in [wrangler.jsonc](C:/Users/hendricksk4/Downloads/fmhy-mcp/wrangler.jsonc) and the path handling in [src/worker.mjs](C:/Users/hendricksk4/Downloads/fmhy-mcp/src/worker.mjs).
- The Worker validates `Origin` when present.
- KV is strongly recommended so cache survives cold starts.
