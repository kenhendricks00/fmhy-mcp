#!/usr/bin/env node

const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");

const { loadNodeIndex } = require("./node-data.cjs");
const { createFmhyServer } = require("./server.cjs");

async function main() {
  const server = createFmhyServer({
    loadIndex: loadNodeIndex,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("fmhy-mcp server running on stdio");
}

main().catch((error) => {
  console.error("fmhy-mcp server error:", error);
  process.exit(1);
});
