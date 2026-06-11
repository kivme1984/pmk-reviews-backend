import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const port = 18790;
const workingDirectory = fileURLToPath(new URL(".", import.meta.url));
const testCache = join(workingDirectory, "cache.test.json");
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: workingDirectory,
  env: {
    ...process.env,
    PORT: String(port),
    PMK_REVIEWS_CACHE_FILE: testCache,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForJson(url) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await fetch(url).then((res) => res.json());
    } catch (error) {
      lastError = error;
      await delay(200);
    }
  }
  throw lastError;
}

async function waitForSources(url, expected) {
  let payload;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    payload = await waitForJson(url);
    if (Array.isArray(payload.sources) && payload.sources.length === expected) {
      return payload;
    }
    await delay(200);
  }
  return payload;
}

try {
  const health = await waitForJson(`http://127.0.0.1:${port}/health`);
  const summary = await waitForSources(
    `http://127.0.0.1:${port}/api/reviews/summary`,
    3
  );

  if (!health.ok) throw new Error("Healthcheck failed");
  if (!Array.isArray(summary.sources) || summary.sources.length !== 3) {
    throw new Error("Summary must contain three sources");
  }
  if (summary.sources.some((source) => "error" in source)) {
    throw new Error("Public response leaked an internal error");
  }

  console.log("reviews collector test: ok");
} finally {
  child.kill();
  await rm(testCache, { force: true });
  await rm(`${testCache}.tmp`, { force: true });
}
