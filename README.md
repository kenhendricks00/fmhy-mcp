# FMHY MCP Server

This repository exposes the FMHY single-page dataset at `https://api.fmhy.net/single-page` as a local `stdio` MCP server.

It is not specific to LM Studio. Any MCP host that supports launching local `stdio` servers should be able to use it. LM Studio is just one example.

## What it exposes

- `fmhy_search`: keyword search across FMHY sections and entries
- `fmhy_get_section`: fetch a full section by heading or slug
- `fmhy_get_links`: find matching FMHY entries and their URLs
- `fmhy_list_sections`: list section headings for navigation
- `fmhy_refresh_cache`: force-refresh the local cache

The server caches the FMHY source in [cache/fmhy-single-page.md](./cache/fmhy-single-page.md) and refreshes it automatically every 6 hours by default.

## Host support

This project implements a standard local `stdio` MCP server. The core launch shape is:

```json
{
  "command": "node",
  "args": ["C:\\Users\\[NAME]\\fmhy-mcp\\src\\index.js"]
}
```

That means it can be used by LM Studio and other MCP clients that support local process-based servers.

## Install

```powershell
npm install
```

## Run

```powershell
npm start
```

## LM Studio setup

LM Studio supports MCP servers through its `mcp.json` file and follows Cursor-style `mcp.json` notation:

https://lmstudio.ai/docs/app/mcp

Add this entry in LM Studio:

```json
{
  "fmhy-mcp": {
    "command": "node",
    "args": ["C:\\Users\\[NAME]\\fmhy-mcp\\src\\index.js"]
  }
}
```

If you prefer environment variables:

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

## Local verification

```powershell
npm run smoke
```
