const AVITO_URL =
  "https://www.avito.ru/brands/2f063b13cfe4e68d70057583613ffdd0/all/predlozheniya_uslug?gdlkerfdnwq=101&page_from=from_item_card&iid=3733321136&sellerId=e31389bb41c929a6a513e47ef1a71b7f";
const YANDEX_URL =
  "https://yandex.ru/maps/org/60740134109/reviews?reviews%5BpublicId%5D=t1q6k76wh5nge37pe1vjt7ewk4&si=t1q6k76wh5nge37pe1vjt7ewk4&utm_source=my_review";

const SOURCES = {
  yandex: {
    id: "yandex",
    name: "Яндекс",
    profileUrl: YANDEX_URL,
  },
  avito: {
    id: "avito",
    name: "Avito",
    profileUrl: AVITO_URL,
  },
  vk: {
    id: "vk",
    name: "ВКонтакте",
    profileUrl: "https://vk.com/reviews-228936595",
  },
};

const VERIFIED_AVITO = {
  rating: 5,
  reviewCount: 343,
  verifiedAt: "2026-06-15T00:00:00+03:00",
  review: {
    id: "avito-verified-2026-06-05",
    author: 'ООО "Сервеса Порфавор"',
    text: "Боже это просто невероятно, ощущение что мы просто купили новые ковры 🔥🔥🔥🔥",
    rating: 5,
    publishedAt: "5 июня",
    url: AVITO_URL,
  },
};

const VERIFIED_YANDEX = {
  rating: 5,
  reviewCount: 76,
  verifiedAt: "2026-06-19T12:00:00+03:00",
  review: {
    id: "yandex-verified-natalya-doronina",
    author: "Наталья Доронина",
    text: "Огромное спасибо данной фабрике по чистке ковров. Позвонила и сразу забрали ковры. Почистили быстро, в течение трёх дней. Ковры как новые, ворс поднялся.",
    rating: 5,
    publishedAt: "12 апреля 2025",
    url: YANDEX_URL,
  },
};

function corsHeaders() {
  return {
    "access-control-allow-origin": "https://pro-moykover.tilda.ws",
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

function json(body, status = 200, ttl = 300) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${ttl}`,
    },
  });
}

function unavailable(source) {
  return {
    ...source,
    rating: null,
    reviewCount: null,
    reviews: [],
    fetchedAt: null,
    status: "unavailable",
  };
}

function scrapeResult(payload, selector) {
  return (
    payload?.result?.find((entry) => entry.selector === selector)?.results || []
  );
}

function parseCount(value) {
  const match = String(value || "").match(/\d[\d\s]*/);
  return match ? Number(match[0].replace(/\s/g, "")) : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function browserScrape(env, payload) {
  const retryDelays = [0, 2500, 7000];
  let response;
  for (const delay of retryDelays) {
    if (delay) await sleep(delay);
    response = await env.BROWSER.quickAction("scrape", payload);
    if (response.status !== 429) return response;
  }
  return response;
}

async function collectAvito(env) {
  const selectors = [
    '[data-marker="ratingSummary/rating"]',
    '[data-marker="ratingSummary/description"]',
    '[data-marker^="review("][data-marker$="/header/title"]',
    '[data-marker^="review("][data-marker$="/header/subtitle"]',
    '[data-marker^="review("][data-marker$="/text-section/text"]',
  ];
  const response = await browserScrape(env, {
    url: AVITO_URL,
    elements: selectors.map((selector) => ({ selector })),
    gotoOptions: { waitUntil: "networkidle2", timeout: 30000 },
  });
  if (!response.ok) throw new Error(`Browser Run HTTP ${response.status}`);

  const payload = await response.json();
  const rating = Number(
    scrapeResult(payload, selectors[0])[0]?.text?.replace(",", ".")
  );
  const reviewCount = parseCount(scrapeResult(payload, selectors[1])[0]?.text);
  if (!Number.isFinite(rating) || !reviewCount) {
    throw new Error("Avito rating was not found");
  }

  const authors = scrapeResult(payload, selectors[2]);
  const dates = scrapeResult(payload, selectors[3]);
  const texts = scrapeResult(payload, selectors[4]);
  const reviews = texts.slice(0, 6).map((entry, index) => ({
    id: `avito-${index}-${dates[index]?.text || ""}`,
    author: authors[index]?.text || "Клиент Avito",
    text: entry.text,
    rating: 5,
    publishedAt: dates[index]?.text || null,
    url: AVITO_URL,
  }));

  return {
    ...SOURCES.avito,
    rating,
    reviewCount,
    reviews,
    fetchedAt: new Date().toISOString(),
    status: "ok",
  };
}

async function collectYandex() {
  const response = await fetch(YANDEX_URL, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ru-RU,ru;q=0.9",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137 Safari/537.36",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Yandex HTTP ${response.status}`);

  const html = await response.text();
  const ratingMatch = html.match(
    /itemProp=["']ratingValue["']\s+content=["'](\d+(?:[.,]\d+)?)["']/i
  );
  const reviewCountMatch = html.match(
    /itemProp=["']reviewCount["']\s+content=["'](\d+)["']/i
  );
  const rating = ratingMatch
    ? Number(ratingMatch[1].replace(",", "."))
    : null;
  const reviewCount = reviewCountMatch ? Number(reviewCountMatch[1]) : null;
  if (!Number.isFinite(rating) || !reviewCount) {
    throw new Error("Yandex structured rating was not found");
  }

  return {
    ...SOURCES.yandex,
    rating,
    reviewCount,
    reviews: [VERIFIED_YANDEX.review],
    fetchedAt: new Date().toISOString(),
    status: "ok",
  };
}

function verifiedAvitoFallback() {
  return {
    ...SOURCES.avito,
    rating: VERIFIED_AVITO.rating,
    reviewCount: VERIFIED_AVITO.reviewCount,
    reviews: [VERIFIED_AVITO.review],
    fetchedAt: VERIFIED_AVITO.verifiedAt,
    status: "stale",
  };
}

function verifiedYandexFallback() {
  return {
    ...SOURCES.yandex,
    rating: VERIFIED_YANDEX.rating,
    reviewCount: VERIFIED_YANDEX.reviewCount,
    reviews: [VERIFIED_YANDEX.review],
    fetchedAt: VERIFIED_YANDEX.verifiedAt,
    status: "stale",
  };
}

async function buildSummary(env) {
  let avito;
  let yandex;
  const collectorErrors = {};
  try {
    avito = await collectAvito(env);
  } catch (error) {
    collectorErrors.avito = error instanceof Error ? error.message : String(error);
    avito = verifiedAvitoFallback();
  }
  try {
    yandex = await collectYandex(env);
  } catch (error) {
    collectorErrors.yandex = error instanceof Error ? error.message : String(error);
    yandex = verifiedYandexFallback();
  }
  return {
    generatedAt: new Date().toISOString(),
    updatedAt: new Date(
      Math.max(
        new Date(yandex.fetchedAt).getTime(),
        new Date(avito.fetchedAt).getTime()
      )
    ).toISOString(),
    sources: [
      yandex,
      avito,
      unavailable(SOURCES.vk),
    ],
    collectorErrors,
  };
}

function summaryCacheKey(request) {
  const day = new Date().toISOString().slice(0, 10);
  return new Request(
    new URL(`/api/reviews/summary?v=10&day=${day}`, request.url).toString(),
    { method: "GET" }
  );
}

async function buildAndCacheSummary(request, env, ctx) {
  const response = json(await buildSummary(env), 200, 300);
  const cacheResponse = new Response(response.clone().body, response);
  cacheResponse.headers.set("cache-control", "public, max-age=86400");
  ctx.waitUntil(caches.default.put(summaryCacheKey(request), cacheResponse));
  return response;
}

async function getSummary(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = summaryCacheKey(request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  return buildAndCacheSummary(request, env, ctx);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "pmk-reviews-worker" });
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/reviews/summary"
    ) {
      return getSummary(request, env, ctx);
    }
    if (
      request.method === "GET" &&
      (url.pathname === "/api/reviews/latest" ||
        url.pathname === "/api/reviews/events/latest")
    ) {
      return json({
        updatedAt: null,
        [url.pathname.includes("events") ? "events" : "reviews"]: [],
      });
    }
    return json({ success: false, message: "Not found" }, 404);
  },
  async scheduled(controller, env, ctx) {
    const request = new Request(
      "https://pmk-reviews-backend.standart-media.workers.dev/api/reviews/summary"
    );
    ctx.waitUntil(buildAndCacheSummary(request, env, ctx));
  },
};
