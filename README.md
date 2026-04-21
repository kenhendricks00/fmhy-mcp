# FMHY MCP Server

Public MCP server for the FMHY single-page dataset at `https://api.fmhy.net/single-page`.

## Endpoint

- MCP: `https://fmhy-mcp.ken.tools/mcp`
- Status page: `https://fmhy-mcp.ken.tools/`

This is a `Streamable HTTP` MCP endpoint, not a normal REST API.

## Tools

- `fmhy_search`: search FMHY sections and entries by keyword
- `fmhy_get_section`: fetch a full FMHY section by heading or slug
- `fmhy_get_links`: return matching FMHY entries and their URLs
- `fmhy_list_sections`: list section headings for navigation
- `fmhy_refresh_cache`: force-refresh the cached FMHY dataset

## Example Config

```json
{
  "url": "https://fmhy-mcp.ken.tools/mcp"
}
```

## Local `stdio` Use

This project can also run as a local `stdio` MCP server for clients that support launching local processes, including LM Studio and similar desktop MCP hosts.

Install dependencies:

```powershell
npm install
```

Run locally:

```powershell
npm start
```

Example local process config:

```json
{
  "command": "node",
  "args": ["C:\\Users\\[NAME]\\fmhy-mcp\\src\\index.js"]
}
```

### LM Studio

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

## Quick Check

Root info page:

```powershell
Invoke-WebRequest -Uri "https://fmhy-mcp.ken.tools/"
```

MCP transport check:

```powershell
$headers = @{ Accept = "text/event-stream" }
Invoke-WebRequest -Uri "https://fmhy-mcp.ken.tools/mcp" -Headers $headers -Method GET
```

## Notes

- `/mcp` expects MCP-compatible requests.
- Direct browser or REST-style requests to `/mcp` may fail unless they send the correct transport headers.
