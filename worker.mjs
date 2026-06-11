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
  reviewCount: 342,
  verifiedAt: "2026-06-11T00:00:00+03:00",
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
  reviewCount: 75,
  verifiedAt: "2026-06-11T23:30:00+03:00",
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

async function collectAvito(env) {
  const selectors = [
    '[data-marker="ratingSummary/rating"]',
    '[data-marker="ratingSummary/description"]',
    '[data-marker^="review("][data-marker$="/header/title"]',
    '[data-marker^="review("][data-marker$="/header/subtitle"]',
    '[data-marker^="review("][data-marker$="/text-section/text"]',
  ];
  const response = await env.BROWSER.quickAction("scrape", {
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

async function collectYandex(env) {
  const selectors = [
    ".business-summary-rating-badge-view__rating",
    "h2.card-section-header__title._wide",
    ".business-review-view__author-name",
    ".business-review-view__date",
    ".business-review-view__body",
  ];
  const response = await env.BROWSER.quickAction("scrape", {
    url: YANDEX_URL,
    elements: selectors.map((selector) => ({ selector })),
    gotoOptions: { waitUntil: "networkidle2", timeout: 30000 },
  });
  if (!response.ok) throw new Error(`Browser Run HTTP ${response.status}`);

  const payload = await response.json();
  const ratingText = scrapeResult(payload, selectors[0])[0]?.text || "";
  const ratingMatch = ratingText.match(/\d+(?:[,.]\d+)?/);
  const rating = ratingMatch
    ? Number(ratingMatch[0].replace(",", "."))
    : null;
  const reviewHeadings = scrapeResult(payload, selectors[1]);
  const reviewCountEntry = reviewHeadings.find((entry) =>
    /отзыв/i.test(entry.text || "")
  );
  const reviewCount = parseCount(reviewCountEntry?.text);
  if (!Number.isFinite(rating) || !reviewCount) {
    throw new Error("Yandex rating was not found");
  }

  const authors = scrapeResult(payload, selectors[2]);
  const dates = scrapeResult(payload, selectors[3]);
  const texts = scrapeResult(payload, selectors[4]);
  const reviews = texts
    .map((entry, index) => ({
      id: `yandex-${index}-${dates[index]?.text || ""}`,
      author: authors[index]?.text || "Клиент Яндекса",
      text: entry.text,
      rating: null,
      publishedAt: dates[index]?.text || null,
      url: YANDEX_URL,
    }))
    .filter((review) => review.author.toLowerCase() !== "kivme")
    .slice(0, 6);

  return {
    ...SOURCES.yandex,
    rating,
    reviewCount,
    reviews,
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
    reviews: [],
    fetchedAt: VERIFIED_YANDEX.verifiedAt,
    status: "stale",
  };
}

async function buildSummary(env) {
  let avito;
  let yandex;
  try {
    avito = await collectAvito(env);
  } catch {
    avito = verifiedAvitoFallback();
  }
  try {
    yandex = await collectYandex(env);
  } catch {
    yandex = verifiedYandexFallback();
  }
  return {
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
  };
}

async function getSummary(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(
    new URL("/api/reviews/summary?v=4", request.url).toString(),
    { method: "GET" }
  );
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = json(await buildSummary(env), 200, 300);
  const cacheResponse = new Response(response.clone().body, response);
  cacheResponse.headers.set("cache-control", "public, max-age=86400");
  ctx.waitUntil(cache.put(cacheKey, cacheResponse));
  return response;
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
};
