const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const z = require("zod/v4");

const {
  DEFAULT_MAX_RESULTS,
  DEFAULT_SECTION_CHARS,
  MAX_RESULTS,
  MAX_SECTION_CHARS,
  buildSectionOverview,
  clamp,
  findSection,
  formatLinks,
  formatSearchResults,
  searchIndex,
} = require("./core.cjs");

function createFmhyServer(options) {
  if (!options || typeof options.loadIndex !== "function") {
    throw new Error("createFmhyServer requires a loadIndex function.");
  }

  const server = new McpServer({
    name: options.name || "fmhy-mcp",
    version: options.version || "1.0.0",
  });

  server.registerTool(
    "fmhy_search",
    {
      description: "Search the FMHY single-page dataset by keyword and return ranked section or entry matches.",
      inputSchema: {
        query: z.string().min(1).describe("Search terms to look up in FMHY."),
        max_results: z.number().int().min(1).max(MAX_RESULTS).optional(),
        section: z
          .string()
          .optional()
          .describe("Optional section title filter, such as 'AI Tools' or 'VPN'."),
        include_urls: z
          .boolean()
          .optional()
          .describe("Include matched URLs when available. Defaults to true."),
        refresh: z
          .boolean()
          .optional()
          .describe("Refresh the cached FMHY dataset before searching."),
      },
    },
    async ({ query, max_results, section, include_urls, refresh }) => {
      const index = await options.loadIndex({ refresh });
      const results = searchIndex(index, query, {
        maxResults: max_results ?? DEFAULT_MAX_RESULTS,
        section,
      });

      return {
        content: [
          {
            type: "text",
            text: formatSearchResults(results, include_urls ?? true),
          },
        ],
        structuredContent: {
          query,
          section: section || null,
          total_results: results.length,
          fetched_at: index.meta.fetchedAt,
          source_url: index.meta.sourceUrl,
          results,
        },
      };
    }
  );

  server.registerTool(
    "fmhy_get_section",
    {
      description: "Retrieve the full text for a FMHY section by heading title or slug.",
      inputSchema: {
        title_or_slug: z
          .string()
          .min(1)
          .describe("Heading text or slug, such as 'AI Coding Tools' or 'ai-coding-tools'."),
        max_chars: z.number().int().min(500).max(MAX_SECTION_CHARS).optional(),
        refresh: z.boolean().optional(),
      },
    },
    async ({ title_or_slug, max_chars, refresh }) => {
      const index = await options.loadIndex({ refresh });
      const section = findSection(index, title_or_slug);

      if (!section) {
        return {
          content: [
            {
              type: "text",
              text: `No FMHY section matched "${title_or_slug}".`,
            },
          ],
          structuredContent: {
            found: false,
            query: title_or_slug,
          },
        };
      }

      const limit = clamp(max_chars ?? DEFAULT_SECTION_CHARS, 500, MAX_SECTION_CHARS);
      const fullText = `# ${section.title}\n\n${section.content}`.trim();
      const truncated = fullText.length > limit;
      const text = truncated ? `${fullText.slice(0, limit)}\n\n[Truncated]` : fullText;

      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
        structuredContent: {
          found: true,
          title: section.title,
          slug: section.slug,
          level: section.level,
          truncated,
          fetched_at: index.meta.fetchedAt,
          source_url: index.meta.sourceUrl,
        },
      };
    }
  );

  server.registerTool(
    "fmhy_get_links",
    {
      description: "Return FMHY entries with URLs that match a query, useful for link lookup.",
      inputSchema: {
        query: z.string().min(1).describe("Search terms for linked FMHY entries."),
        max_results: z.number().int().min(1).max(MAX_RESULTS).optional(),
        section: z.string().optional(),
        refresh: z.boolean().optional(),
      },
    },
    async ({ query, max_results, section, refresh }) => {
      const index = await options.loadIndex({ refresh });
      const results = searchIndex(index, query, {
        maxResults: max_results ?? DEFAULT_MAX_RESULTS,
        section,
      }).filter((result) => result.kind === "entry" && result.links.length > 0);

      return {
        content: [
          {
            type: "text",
            text: formatLinks(results),
          },
        ],
        structuredContent: {
          query,
          section: section || null,
          total_results: results.length,
          fetched_at: index.meta.fetchedAt,
          source_url: index.meta.sourceUrl,
          results,
        },
      };
    }
  );

  server.registerTool(
    "fmhy_list_sections",
    {
      description: "List FMHY section headings so a client can navigate the single-page dataset.",
      inputSchema: {
        refresh: z.boolean().optional(),
      },
    },
    async ({ refresh }) => {
      const index = await options.loadIndex({ refresh });
      const overview = buildSectionOverview(index);

      return {
        content: [
          {
            type: "text",
            text: overview,
          },
        ],
        structuredContent: {
          fetched_at: index.meta.fetchedAt,
          source_url: index.meta.sourceUrl,
          section_count: index.meta.sectionCount,
          sections: index.sections.map((section) => ({
            title: section.title,
            slug: section.slug,
            level: section.level,
          })),
        },
      };
    }
  );

  server.registerTool(
    "fmhy_refresh_cache",
    {
      description: "Force-refresh the cached copy of the FMHY single-page dataset.",
      inputSchema: {},
    },
    async () => {
      const index = await options.loadIndex({ refresh: true });
      return {
        content: [
          {
            type: "text",
            text: `Refreshed FMHY cache.\nSections: ${index.meta.sectionCount}\nEntries: ${index.meta.entryCount}\nFetched: ${index.meta.fetchedAt}`,
          },
        ],
        structuredContent: index.meta,
      };
    }
  );

  return server;
}

module.exports = {
  createFmhyServer,
};
