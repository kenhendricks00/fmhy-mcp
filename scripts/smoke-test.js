const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function main() {
  const client = new Client({
    name: "fmhy-mcp-smoke-test",
    version: "1.0.0",
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(__dirname, "..", "src", "index.js")],
    cwd: path.resolve(__dirname, ".."),
    stderr: "pipe",
  });

  if (transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
  }

  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name).sort();
  console.log(`Tools: ${toolNames.join(", ")}`);

  const sections = await client.callTool({
    name: "fmhy_list_sections",
    arguments: {},
  });
  console.log(`Section listing returned ${sections.content.length} content item(s).`);

  const search = await client.callTool({
    name: "fmhy_search",
    arguments: {
      query: "vpn",
      max_results: 3,
    },
  });

  const searchText = search.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  console.log(searchText.slice(0, 800));

  await transport.close();
}

main().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exit(1);
});
