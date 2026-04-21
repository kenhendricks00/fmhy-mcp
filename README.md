# FMHY MCP Server

This repository exposes the FMHY single-page dataset at `https://api.fmhy.net/single-page`.

It now supports both:

- local `stdio` MCP for tools like LM Studio
- remote `Streamable HTTP` MCP on Cloudflare Workers

## What it exposes

- `fmhy_search`: keyword search across FMHY sections and entries
- `fmhy_get_section`: fetch a full section by heading or slug
- `fmhy_get_links`: find matching FMHY entries and their URLs
- `fmhy_list_sections`: list section headings for navigation
- `fmhy_refresh_cache`: force-refresh the cache

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

Recommended public endpoint:

- `https://fmhy-mcp.ken.tools/mcp`

The Worker entrypoint is [src/worker.mjs](C:/Users/hendricksk4/Downloads/fmhy-mcp/src/worker.mjs). It serves MCP over `Streamable HTTP` and uses Cloudflare KV for cache persistence.

### Files added for Cloudflare

- [wrangler.jsonc](C:/Users/hendricksk4/Downloads/fmhy-mcp/wrangler.jsonc)
- [src/worker.mjs](C:/Users/hendricksk4/Downloads/fmhy-mcp/src/worker.mjs)
- [.dev.vars.example](C:/Users/hendricksk4/Downloads/fmhy-mcp/.dev.vars.example)

### One-time setup

1. Install dependencies:

```powershell
npm install
```

2. Log into Cloudflare:

```powershell
npx wrangler login
```

3. The main KV namespace ID is already filled into [wrangler.jsonc](C:/Users/hendricksk4/Downloads/fmhy-mcp/wrangler.jsonc) using the value you provided:

- `b789d1e93a294a1ea52bca9bc9d0b584`

4. Create a preview KV namespace for local `wrangler dev`:

```powershell
npx wrangler kv namespace create FMHY_CACHE --preview
```

5. Copy the returned preview namespace ID into [wrangler.jsonc](C:/Users/hendricksk4/Downloads/fmhy-mcp/wrangler.jsonc) for:

- `preview_id`

6. Set the Worker secret for auth:

```powershell
npx wrangler secret put FMHY_API_TOKEN
```

Use a long random token. Your MCP client will send it as:

```text
Authorization: Bearer <your-token>
```

7. Optionally set non-secret vars in a local `.dev.vars` file for local Worker testing:

```dotenv
FMHY_API_TOKEN=replace-with-a-long-random-token
ALLOWED_ORIGINS=https://fmhy-mcp.ken.tools
FMHY_SOURCE_URL=https://api.fmhy.net/single-page
FMHY_CACHE_TTL_MINUTES=360
```

You can start from [.dev.vars.example](C:/Users/hendricksk4/Downloads/fmhy-mcp/.dev.vars.example).

### Deploy

Deploy the Worker:

```powershell
npm run cf:deploy
```

The included [wrangler.jsonc](C:/Users/hendricksk4/Downloads/fmhy-mcp/wrangler.jsonc) is already set to attach the Worker to:

- `fmhy-mcp.ken.tools`

After deploy, your MCP endpoint will be:

- `https://fmhy-mcp.ken.tools/mcp`

### Local Worker dev

```powershell
npm run cf:dev
```

### MCP client configuration for remote use

Use your hosted endpoint:

```json
{
  "url": "https://fmhy-mcp.ken.tools/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_TOKEN"
  }
}
```

### Notes

- If you prefer `api.ken.tools/fmhy-mcp`, update the Worker route and path handling in [wrangler.jsonc](C:/Users/hendricksk4/Downloads/fmhy-mcp/wrangler.jsonc) and [src/worker.mjs](C:/Users/hendricksk4/Downloads/fmhy-mcp/src/worker.mjs).
- The Worker validates `Origin` when present and supports bearer-token auth through `FMHY_API_TOKEN`.
- KV is strongly recommended so cache survives cold starts.
