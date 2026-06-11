import http from "node:http";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = process.env.PMK_REVIEWS_CACHE_FILE || join(HERE, "cache.json");
const PORT = Number(process.env.PORT || 8790);
const REFRESH_SECRET = process.env.PMK_REVIEWS_REFRESH_SECRET || "";
const ALLOWED_ORIGIN = process.env.PMK_REVIEWS_ALLOWED_ORIGIN || "*";
const DAY_MS = 24 * 60 * 60 * 1000;

const SOURCES = {
  yandex: {
    name: "Яндекс",
    profileUrl:
      "https://yandex.ru/maps/org/60740134109/reviews?reviews%5BpublicId%5D=t1q6k76wh5nge37pe1vjt7ewk4&si=t1q6k76wh5nge37pe1vjt7ewk4&utm_source=my_review",
  },
  avito: {
    name: "Avito",
    profileUrl:
      "https://www.avito.ru/brands/2f063b13cfe4e68d70057583613ffdd0/all/predlozheniya_uslug?gdlkerfdnwq=101&page_from=from_item_card&iid=3733321136&sellerId=e31389bb41c929a6a513e47ef1a71b7f",
  },
  vk: {
    name: "ВКонтакте",
    profileUrl: "https://vk.com/reviews-228936595",
  },
};

const FEEDS = {
  yandex: ["PMK_YANDEX_FEED_URL", "PMK_YANDEX_FEED_TOKEN"],
  avito: ["PMK_AVITO_FEED_URL", "PMK_AVITO_FEED_TOKEN"],
  vk: ["PMK_VK_FEED_URL", "PMK_VK_FEED_TOKEN"],
};

function corsHeaders() {
  return {
    "access-control-allow-origin": ALLOWED_ORIGIN,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    vary: "Origin",
  };
}

function sendJson(res, status, body, cacheControl = "no-store") {
  res.writeHead(status, {
    ...corsHeaders(),
    "content-type": "application/json; charset=utf-8",
    "cache-control": cacheControl,
  });
  res.end(JSON.stringify(body));
}

async function readCache() {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8"));
  } catch {
    return { updatedAt: null, sources: {} };
  }
}

async function writeCache(cache) {
  const temporary = `${CACHE_FILE}.tmp`;
  await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  await rename(temporary, CACHE_FILE);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeReview(review) {
  if (!review || typeof review !== "object") return null;
  const text = String(review.text || "").trim();
  if (!text) return null;
  return {
    id: String(review.id || ""),
    author: String(review.author || "Клиент").trim(),
    text: text.slice(0, 1200),
    rating: finiteNumber(review.rating),
    publishedAt: review.publishedAt || review.date || null,
    url: review.url || null,
  };
}

function normalizeSource(id, payload) {
  const source = SOURCES[id];
  if (!source) throw new Error(`Unknown source: ${id}`);

  const rating = finiteNumber(payload.rating);
  const reviewCount = finiteNumber(
    payload.reviewCount ?? payload.reviewsCount ?? payload.count
  );
  const reviews = Array.isArray(payload.reviews)
    ? payload.reviews.map(normalizeReview).filter(Boolean).slice(0, 6)
    : [];

  if (rating === null && reviewCount === null && reviews.length === 0) {
    throw new Error(`${source.name}: feed returned no review data`);
  }

  return {
    id,
    name: source.name,
    profileUrl: source.profileUrl,
    rating,
    reviewCount,
    reviews,
    fetchedAt: new Date().toISOString(),
    status: "ok",
  };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      ...options,
      headers: { accept: "application/json", ...(options.headers || {}) },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function markerText(html, marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(`data-marker="${escaped}"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i")
  );
  return match ? decodeHtml(match[1]) : "";
}

async function collectAvitoPublic() {
  const url = SOURCES.avito.profileUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ru-RU,ru;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Avito HTTP ${response.status}`);
    const html = await response.text();

    const ratingText = markerText(html, "ratingSummary/rating").replace(",", ".");
    const countText = markerText(html, "ratingSummary/description");
    const rating = finiteNumber(ratingText);
    const reviewCount = finiteNumber((countText.match(/\d[\d\s]*/) || [""])[0].replace(/\s/g, ""));
    const reviews = [];

    for (let index = 0; index < 6; index += 1) {
      const author = markerText(html, `review(${index})/header/title`);
      const publishedAt = markerText(html, `review(${index})/header/subtitle`);
      const text = markerText(html, `review(${index})/text-section/text`);
      if (!text) continue;
      reviews.push({
        id: `avito-${index}-${publishedAt}`,
        author: author || "Клиент Avito",
        text,
        rating: 5,
        publishedAt: publishedAt || null,
        url,
      });
    }

    return normalizeSource("avito", { rating, reviewCount, reviews });
  } finally {
    clearTimeout(timeout);
  }
}

async function collectNormalizedFeed(id, urlEnv, tokenEnv) {
  const url = process.env[urlEnv];
  if (!url) return null;
  const token = process.env[tokenEnv];
  const payload = await fetchJson(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return normalizeSource(id, payload);
}

async function collectAll(previousCache = { sources: {} }) {
  const attempts = Object.entries(FEEDS).map(([id, [urlEnv, tokenEnv]]) => [
    id,
    () =>
      id === "avito" && !process.env[urlEnv]
        ? collectAvitoPublic()
        : collectNormalizedFeed(id, urlEnv, tokenEnv),
  ]);

  const settled = await Promise.all(
    attempts.map(async ([id, collect]) => {
      try {
        return [id, await collect(), null];
      } catch (error) {
        return [id, null, error.message];
      }
    })
  );

  const sources = {};
  for (const id of Object.keys(SOURCES)) {
    const result = settled.find(([settledId]) => settledId === id) || [];
    const fresh = result[1];
    const error = result[2];
    if (fresh) {
      sources[id] = fresh;
      continue;
    }

    const previous = previousCache.sources?.[id];
    sources[id] = previous
      ? { ...previous, status: error ? "stale" : previous.status, error }
      : {
          id,
          ...SOURCES[id],
          rating: null,
          reviewCount: null,
          reviews: [],
          fetchedAt: null,
          status: "unavailable",
          error: error || "Источник ещё не подключён",
        };
  }

  const cache = { updatedAt: new Date().toISOString(), sources };
  await writeCache(cache);
  return cache;
}

function publicSource(source) {
  const { error, ...safe } = source;
  return safe;
}

function summary(cache) {
  return {
    updatedAt: cache.updatedAt,
    sources: Object.values(cache.sources || {}).map(publicSource),
  };
}

function latest(cache) {
  return {
    updatedAt: cache.updatedAt,
    reviews: Object.values(cache.sources || {})
      .flatMap((source) =>
        (source.reviews || []).map((review) => ({
          ...review,
          sourceId: source.id,
          sourceName: source.name,
          profileUrl: source.profileUrl,
        }))
      )
      .sort((a, b) =>
        String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""))
      )
      .slice(0, 12),
  };
}

function events(cache) {
  return {
    updatedAt: cache.updatedAt,
    events: latest(cache)
      .reviews.filter((review) => review.publishedAt)
      .slice(0, 5)
      .map((review) => ({
        type: "review",
        sourceId: review.sourceId,
        rating: review.rating,
        publishedAt: review.publishedAt,
      })),
  };
}

let cache = await readCache();
let refreshPromise = null;

async function refresh() {
  if (!refreshPromise) {
    refreshPromise = collectAll(cache)
      .then((next) => {
        cache = next;
        return next;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "pmk-reviews-backend-collector",
      updatedAt: cache.updatedAt,
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/reviews/summary") {
    sendJson(res, 200, summary(cache), "public, max-age=300");
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/reviews/latest") {
    sendJson(res, 200, latest(cache), "public, max-age=300");
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/reviews/events/latest") {
    sendJson(res, 200, events(cache), "public, max-age=300");
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/reviews/refresh") {
    if (!REFRESH_SECRET || url.searchParams.get("secret") !== REFRESH_SECRET) {
      sendJson(res, 401, { success: false, message: "Unauthorized" });
      return;
    }
    const refreshed = await refresh();
    sendJson(res, 200, { success: true, ...summary(refreshed) });
    return;
  }

  sendJson(res, 404, { success: false, message: "Not found" });
});

server.listen(PORT, () => {
  console.log(`PMK reviews collector is listening on http://localhost:${PORT}`);
  refresh().catch((error) => {
    console.error(JSON.stringify({ event: "reviews_refresh_error", error: error.message }));
  });
  const timer = setInterval(() => {
    refresh().catch((error) => {
      console.error(JSON.stringify({ event: "reviews_refresh_error", error: error.message }));
    });
  }, DAY_MS);
  timer.unref();
});
