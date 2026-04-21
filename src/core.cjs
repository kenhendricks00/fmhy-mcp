const TurndownService = require("turndown");

const DEFAULT_SOURCE_URL = "https://api.fmhy.net/single-page";
const DEFAULT_CACHE_TTL_MINUTES = 360;
const DEFAULT_CACHE_TTL_MS = DEFAULT_CACHE_TTL_MINUTES * 60 * 1000;
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

function escapeMarkdownLinkText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function formatInlineLinks(links, maxLinks) {
  const selectedLinks =
    typeof maxLinks === "number" ? links.slice(0, Math.max(maxLinks, 0)) : links;

  return selectedLinks
    .map((link) => {
      const label = escapeMarkdownLinkText(stripMarkdown(link.text) || link.url);
      return `[${label}](${link.url})`;
    })
    .join(" | ");
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

function looksLikeHtml(text, contentType) {
  return (
    String(contentType || "").includes("text/html") ||
    /^\s*<!doctype html/i.test(text) ||
    /^\s*<html/i.test(text)
  );
}

function normalizeSourceText(rawText, contentType) {
  return looksLikeHtml(rawText, contentType) ? turndown.turndown(rawText) : rawText;
}

async function fetchSourceDocument(options = {}) {
  const sourceUrl = options.sourceUrl || DEFAULT_SOURCE_URL;
  const fetchImpl = options.fetchImpl || fetch;

  const response = await fetchImpl(sourceUrl, {
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
  const text = normalizeSourceText(rawText, contentType);

  return {
    text,
    fetchedAt: new Date().toISOString(),
    sourceUrl,
  };
}

function buildIndexFromText(options) {
  const parsed = parseDocument(options.text);

  return {
    meta: {
      sourceUrl: options.sourceUrl || DEFAULT_SOURCE_URL,
      fetchedAt: options.fetchedAt || new Date().toISOString(),
      sectionCount: parsed.sections.length,
      entryCount: parsed.entries.length,
      cacheFile: options.cacheFile || null,
    },
    sections: parsed.sections,
    entries: parsed.entries,
  };
}

async function buildIndexFromSource(options = {}) {
  const source = await fetchSourceDocument(options);
  return buildIndexFromText({
    text: source.text,
    fetchedAt: source.fetchedAt,
    sourceUrl: source.sourceUrl,
    cacheFile: options.cacheFile || null,
  });
}

function isFreshTimestamp(timestamp, ttlMs = DEFAULT_CACHE_TTL_MS) {
  if (!timestamp) {
    return false;
  }

  const fetchedAtMs = Date.parse(timestamp);
  if (Number.isNaN(fetchedAtMs)) {
    return false;
  }

  return Date.now() - fetchedAtMs <= ttlMs;
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
        const urls = formatInlineLinks(result.links, 3);
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
      const urls = formatInlineLinks(entry.links);
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

module.exports = {
  DEFAULT_SOURCE_URL,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_MAX_RESULTS,
  MAX_RESULTS,
  DEFAULT_SECTION_CHARS,
  MAX_SECTION_CHARS,
  OVERVIEW_LIMIT,
  buildIndexFromSource,
  buildIndexFromText,
  buildSectionOverview,
  clamp,
  fetchSourceDocument,
  findSection,
  formatLinks,
  formatSearchResults,
  isFreshTimestamp,
  normalizeForSearch,
  searchIndex,
};
