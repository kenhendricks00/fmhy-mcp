import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import coreModule from "./core.cjs";
import serverModule from "./server.cjs";

const {
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_SOURCE_URL,
  buildIndexFromSource,
  isFreshTimestamp,
} = coreModule;
const { createFmhyServer } = serverModule;

const KV_CACHE_KEY = "fmhy:index:v1";

let memoryCache = null;
let inFlightPromise = null;

function getTtlMs(env) {
  const minutes = Number(env.FMHY_CACHE_TTL_MINUTES || String(DEFAULT_CACHE_TTL_MINUTES));
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_CACHE_TTL_MINUTES) * 60 * 1000;
}

function getSourceUrl(env) {
  return env.FMHY_SOURCE_URL || DEFAULT_SOURCE_URL;
}

function isFreshIndex(index, env) {
  return Boolean(index?.meta?.sourceUrl === getSourceUrl(env) && isFreshTimestamp(index?.meta?.fetchedAt, getTtlMs(env)));
}

async function readKvIndex(env) {
  if (!env.FMHY_CACHE) {
    return null;
  }

  return env.FMHY_CACHE.get(KV_CACHE_KEY, "json");
}

async function writeKvIndex(env, index) {
  if (!env.FMHY_CACHE) {
    return;
  }

  await env.FMHY_CACHE.put(KV_CACHE_KEY, JSON.stringify(index));
}

async function buildFreshIndex(env) {
  return buildIndexFromSource({
    sourceUrl: getSourceUrl(env),
    fetchImpl: fetch,
  });
}

function createWorkerIndexLoader(env) {
  return async function loadIndex(options = {}) {
    const refresh = Boolean(options.refresh);

    if (!refresh && isFreshIndex(memoryCache, env)) {
      return memoryCache;
    }

    if (!refresh && inFlightPromise) {
      return inFlightPromise;
    }

    const task = (async () => {
      let staleIndex = memoryCache;

      if (!refresh) {
        try {
          const kvIndex = await readKvIndex(env);
          if (kvIndex?.meta?.sourceUrl === getSourceUrl(env)) {
            staleIndex = kvIndex;
            if (isFreshIndex(kvIndex, env)) {
              memoryCache = kvIndex;
              return kvIndex;
            }
          }
        } catch (_error) {
          // KV is optional; fall back to direct fetch.
        }
      }

      try {
        const freshIndex = await buildFreshIndex(env);
        memoryCache = freshIndex;
        await writeKvIndex(env, freshIndex);
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
  };
}

function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isOriginAllowed(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if (allowedOrigins.length > 0) {
    return allowedOrigins.includes(origin);
  }

  const url = new URL(request.url);
  return origin === `${url.protocol}//${url.host}`;
}

function isAuthorized(request, env) {
  const token = env.FMHY_API_TOKEN;
  if (!token) {
    return true;
  }

  const authorization = request.headers.get("authorization") || "";
  return authorization === `Bearer ${token}`;
}

function buildInfoResponse(request) {
  const url = new URL(request.url);
  const endpoint = `${url.origin}/mcp`;

  return new Response(
    [
      "fmhy-mcp Cloudflare Worker",
      "",
      `MCP endpoint: ${endpoint}`,
      "",
      "Send Streamable HTTP MCP requests to /mcp.",
    ].join("\n"),
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return buildInfoResponse(request);
    }

    if (url.pathname !== "/mcp" && url.pathname !== "/mcp/") {
      return new Response("Not found", { status: 404 });
    }

    if (!isOriginAllowed(request, env)) {
      return new Response("Forbidden origin", { status: 403 });
    }

    if (!isAuthorized(request, env)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "www-authenticate": "Bearer",
        },
      });
    }

    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createFmhyServer({
      loadIndex: createWorkerIndexLoader(env),
    });

    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
