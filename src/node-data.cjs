const fs = require("node:fs/promises");
const path = require("node:path");

const {
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_SOURCE_URL,
  buildIndexFromText,
  fetchSourceDocument,
  isFreshTimestamp,
} = require("./core.cjs");

const CACHE_FILE =
  process.env.FMHY_CACHE_FILE || path.resolve(__dirname, "..", "cache", "fmhy-single-page.md");

let memoryCache = null;
let inFlightPromise = null;

function getSourceUrl() {
  return process.env.FMHY_SOURCE_URL || DEFAULT_SOURCE_URL;
}

function getTtlMs() {
  const minutes = Number(process.env.FMHY_CACHE_TTL_MINUTES || String(DEFAULT_CACHE_TTL_MINUTES));
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_CACHE_TTL_MINUTES) * 60 * 1000;
}

function isFreshIndex(index) {
  return Boolean(index?.meta?.sourceUrl === getSourceUrl() && isFreshTimestamp(index?.meta?.fetchedAt, getTtlMs()));
}

async function ensureCacheDir() {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
}

async function writeCache(text) {
  await ensureCacheDir();
  await fs.writeFile(CACHE_FILE, text, "utf8");
}

async function readCachedIndex() {
  const stats = await fs.stat(CACHE_FILE);
  const text = await fs.readFile(CACHE_FILE, "utf8");

  return buildIndexFromText({
    text,
    fetchedAt: stats.mtime.toISOString(),
    sourceUrl: getSourceUrl(),
    cacheFile: CACHE_FILE,
  });
}

async function fetchAndPersistIndex() {
  const sourceUrl = getSourceUrl();
  const sourceDocument = await fetchSourceDocument({ sourceUrl });
  await writeCache(sourceDocument.text);

  return buildIndexFromText({
    text: sourceDocument.text,
    fetchedAt: sourceDocument.fetchedAt,
    sourceUrl: sourceDocument.sourceUrl,
    cacheFile: CACHE_FILE,
  });
}

async function loadNodeIndex(options = {}) {
  const refresh = Boolean(options.refresh);

  if (!refresh && isFreshIndex(memoryCache)) {
    return memoryCache;
  }

  if (!refresh && inFlightPromise) {
    return inFlightPromise;
  }

  const task = (async () => {
    let staleIndex = memoryCache;

    if (!refresh) {
      try {
        const cachedIndex = await readCachedIndex();
        staleIndex = cachedIndex;
        if (isFreshIndex(cachedIndex)) {
          memoryCache = cachedIndex;
          return cachedIndex;
        }
      } catch (_error) {
        // No cache file yet.
      }
    }

    try {
      const freshIndex = await fetchAndPersistIndex();
      memoryCache = freshIndex;
      return freshIndex;
    } catch (error) {
      if (!refresh && staleIndex) {
        console.error(`Network refresh failed, using cached FMHY data: ${error.message}`);
        memoryCache = staleIndex;
        return staleIndex;
      }

      throw error;
    }
  })();

  const wrappedPromise = task.finally(() => {
    if (inFlightPromise === wrappedPromise) {
      inFlightPromise = null;
    }
  });

  inFlightPromise = wrappedPromise;
  return wrappedPromise;
}

module.exports = {
  CACHE_FILE,
  loadNodeIndex,
};
