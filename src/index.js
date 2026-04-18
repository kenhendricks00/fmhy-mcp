#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const TurndownService = require("turndown");
const z = require("zod/v4");

const SOURCE_URL = process.env.FMHY_SOURCE_URL || "https://api.fmhy.net/single-page";
const CACHE_FILE =
  process.env.FMHY_CACHE_FILE || path.resolve(__dirname, "..", "cache", "fmhy-single-page.md");
const CACHE_TTL_MS = (Number(process.env.FMHY_CACHE_TTL_MINUTES || "360") || 360) * 60 * 1000;
const DEFAULT_MAX_RESULTS = 8;
const MAX_RESULTS = 20;
const DEFAULT_SECTION_CHARS = 12000;
const MAX_SECTION_CHARS = 30000;
const OVERVIEW_LIMIT = 200;

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "*",
  codeBlockStyle: "fenced",
});

let indexPromise = null;

function normalizeForSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return normalizeForSearch(value).replace(/\s+/g, "-");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function stripMarkdown(value) {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(value) {
  const links = [];
  const regex = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let match = regex.exec(value);

  while (match) {
    links.push({
      text: stripMarkdown(match[1]),
      url: match[2],
    });
    match = regex.exec(value);
  }

  return links;
}

function deriveEntryTitle(rawLine, links) {
  if (links.length > 0) {
    return links[0].text;
  }

  const boldMatch = rawLine.match(/\*\*([^*]+)\*\*/);
  if (boldMatch) {
    return stripMarkdown(boldMatch[1]);
  }

  const text = stripMarkdown(rawLine);
  return text.split(/\s+-\s+/)[0].trim() || text.slice(0, 80);
}

function createSnippet(text, query, maxLength = 280) {
  const plain = stripMarkdown(text);
  if (!plain) {
    return "";
  }

  const normalizedText = normalizeForSearch(plain);
  const normalizedQuery = normalizeForSearch(query);
  const index = normalizedQuery ? normalizedText.indexOf(normalizedQuery) : -1;

  if (index === -1 || plain.length <= maxLength) {
    return plain.slice(0, maxLength);
  }

  const start = Math.max(0, index - Math.floor(maxLength / 3));
  const end = Math.min(plain.length, start + maxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < plain.length ? "..." : "";
  return `${prefix}${plain.slice(start, end).trim()}${suffix}`;
}

function countOccurrences(text, token) {
  let count = 0;
  let fromIndex = 0;

  while (fromIndex >= 0) {
    const foundAt = text.indexOf(token, fromIndex);
    if (foundAt === -1) {
      break;
    }
    count += 1;
    fromIndex = foundAt + token.length;
  }

  return count;
}

function scoreText(title, body, query) {
  const normalizedTitle = normalizeForSearch(title);
  const normalizedBody = normalizeForSearch(body);
  const normalizedQuery = normalizeForSearch(query);

  if (!normalizedQuery) {
    return 0;
  }

  const tokens = normalizedQuery.split(" ").filter(Boolean);
  let score = 0;

  if (normalizedTitle.includes(normalizedQuery)) {
    score += 25;
  }
  if (normalizedBody.includes(normalizedQuery)) {
    score += 10;
  }

  for (const token of tokens) {
    if (normalizedTitle.includes(token)) {
      score += 8 + countOccurrences(normalizedTitle, token) * 2;
    }
    if (normalizedBody.includes(token)) {
      score += 2 + Math.min(countOccurrences(normalizedBody, token), 4);
    }
  }

  return score;
}

function parseDocument(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = {
    level: 0,
    title: "Document Root",
    slug: "document-root",
    lines: [],
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!headingMatch) {
      current.lines.push(line);
      continue;
    }

    if (current.title !== "Document Root" || current.lines.some((value) => value.trim())) {
      sections.push(current);
    }

    current = {
      level: headingMatch[1].length,
      title: stripMarkdown(headingMatch[2]),
      slug: slugify(headingMatch[2]),
      lines: [],
    };
  }

  if (current.title !== "Document Root" || current.lines.some((value) => value.trim())) {
    sections.push(current);
  }

  const entries = [];

  for (const section of sections) {
    section.content = section.lines.join("\n").trim();
    section.text = stripMarkdown(section.content);

    for (const line of section.lines) {
      if (!/^\s*[*-]\s+/.test(line)) {
        continue;
      }

      const raw = line.replace(/^\s*[*-]\s+/, "").trim();
      const links = extractLinks(raw);
      const title = deriveEntryTitle(raw, links);
      const text = stripMarkdown(raw);

      entries.push({
        title,
        text,
        raw,
        links,
        sectionTitle: section.title,
        sectionSlug: section.slug,
      });
    }
  }

  return { sections, entries };
}

async function ensureCacheDir() {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
}

function looksLikeHtml(text, contentType) {
  return (
    String(contentType || "").includes("text/html") ||
    /^\s*<!doctype html/i.test(text) ||
    /^\s*<html/i.test(text)
  );
}

async function fetchSource() {
  const response = await fetch(SOURCE_URL, {
    headers: {
      "user-agent": "fmhy-mcp/1.0.0",
      accept: "text/plain,text/markdown,text/html;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`FMHY source request failed with ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const rawText = await response.text();
  const text = looksLikeHtml(rawText, contentType) ? turndown.turndown(rawText) : rawText;

  await ensureCacheDir();
  await fs.writeFile(CACHE_FILE, text, "utf8");

  return {
    text,
    fetchedAt: new Date().toISOString(),
    sourceUrl: SOURCE_URL,
  };
}

async function readCache() {
  const stats = await fs.stat(CACHE_FILE);
  const text = await fs.readFile(CACHE_FILE, "utf8");

  return {
    text,
    fetchedAt: stats.mtime.toISOString(),
    sourceUrl: SOURCE_URL,
  };
}

async function loadSource(options = {}) {
  const refresh = Boolean(options.refresh);

  if (!refresh) {
    try {
      const stats = await fs.stat(CACHE_FILE);
      const ageMs = Date.now() - stats.mtimeMs;
      if (ageMs <= CACHE_TTL_MS) {
        return readCache();
      }
    } catch (_error) {
      // Cache miss: fall through to network fetch.
    }
  }

  try {
    return await fetchSource();
  } catch (error) {
    if (refresh) {
      throw error;
    }

    try {
      console.error(`Network refresh failed, using cached FMHY data: ${error.message}`);
      return await readCache();
    } catch {
      throw error;
    }
  }
}

async function buildIndex(options = {}) {
  const source = await loadSource(options);
  const parsed = parseDocument(source.text);

  return {
    meta: {
      sourceUrl: source.sourceUrl,
      fetchedAt: source.fetchedAt,
      sectionCount: parsed.sections.length,
      entryCount: parsed.entries.length,
      cacheFile: CACHE_FILE,
    },
    sections: parsed.sections,
    entries: parsed.entries,
  };
}

async function getIndex(options = {}) {
  if (options.refresh) {
    indexPromise = buildIndex({ refresh: true });
    return indexPromise;
  }

  if (!indexPromise) {
    indexPromise = buildIndex();
  }

  return indexPromise;
}

function filterBySection(items, sectionQuery) {
  if (!sectionQuery) {
    return items;
  }

  const normalizedSection = normalizeForSearch(sectionQuery);
  return items.filter((item) => {
    const sectionTitle = normalizeForSearch(item.sectionTitle || item.title);
    const sectionSlug = normalizeForSearch(item.sectionSlug || item.slug);
    return sectionTitle.includes(normalizedSection) || sectionSlug.includes(normalizedSection);
  });
}

function searchIndex(index, query, options = {}) {
  const maxResults = clamp(options.maxResults || DEFAULT_MAX_RESULTS, 1, MAX_RESULTS);
  const filteredSections = filterBySection(index.sections, options.section);
  const filteredEntries = filterBySection(index.entries, options.section);
  const results = [];

  for (const section of filteredSections) {
    const score = scoreText(section.title, section.text, query);
    if (score <= 0) {
      continue;
    }

    results.push({
      kind: "section",
      title: section.title,
      sectionTitle: section.title,
      sectionSlug: section.slug,
      score,
      snippet: createSnippet(section.text, query),
      links: extractLinks(section.content),
    });
  }

  for (const entry of filteredEntries) {
    const score = scoreText(entry.title, `${entry.text} ${entry.sectionTitle}`, query);
    if (score <= 0) {
      continue;
    }

    results.push({
      kind: "entry",
      title: entry.title,
      sectionTitle: entry.sectionTitle,
      sectionSlug: entry.sectionSlug,
      score,
      snippet: createSnippet(entry.text, query),
      links: entry.links,
    });
  }

  return results
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, maxResults);
}

function findSection(index, titleOrSlug) {
  const normalized = normalizeForSearch(titleOrSlug);
  const exactSlug = slugify(titleOrSlug);

  let match = index.sections.find((section) => section.slug === exactSlug);
  if (match) {
    return match;
  }

  match = index.sections.find((section) => normalizeForSearch(section.title) === normalized);
  if (match) {
    return match;
  }

  const ranked = index.sections
    .map((section) => ({
      section,
      score: scoreText(section.title, `${section.title} ${section.text}`, titleOrSlug),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.section || null;
}

function formatSearchResults(results, includeUrls) {
  if (results.length === 0) {
    return "No FMHY matches found.";
  }

  return results
    .map((result, index) => {
      const lines = [
        `${index + 1}. [${result.kind}] ${result.title}`,
        `   Section: ${result.sectionTitle}`,
      ];

      if (result.snippet) {
        lines.push(`   Snippet: ${result.snippet}`);
      }

      if (includeUrls && result.links.length > 0) {
        const urls = result.links
          .slice(0, 3)
          .map((link) => `${link.text}: ${link.url}`)
          .join(" | ");
        lines.push(`   Links: ${urls}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function formatLinks(links) {
  if (links.length === 0) {
    return "No linked FMHY entries found.";
  }

  return links
    .map((entry, index) => {
      const urls = entry.links.map((link) => `${link.text}: ${link.url}`).join(" | ");
      return `${index + 1}. ${entry.title}\n   Section: ${entry.sectionTitle}\n   Links: ${urls}`;
    })
    .join("\n\n");
}

function buildSectionOverview(index) {
  return index.sections
    .filter((section) => section.level > 0)
    .slice(0, OVERVIEW_LIMIT)
    .map((section) => `${"  ".repeat(Math.max(section.level - 1, 0))}- ${section.title}`)
    .join("\n");
}

async function main() {
  const server = new McpServer({
    name: "fmhy-mcp",
    version: "1.0.0",
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
      const index = await getIndex({ refresh });
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
      const index = await getIndex({ refresh });
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
      const index = await getIndex({ refresh });
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
      const index = await getIndex({ refresh });
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
      description: "Force-refresh the local cached copy of the FMHY single-page dataset.",
      inputSchema: {},
    },
    async () => {
      const index = await getIndex({ refresh: true });
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("fmhy-mcp server running on stdio");
}

main().catch((error) => {
  console.error("fmhy-mcp server error:", error);
  process.exit(1);
});
