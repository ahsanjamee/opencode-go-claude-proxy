import type { DiscoveryResponse, ModelConfig } from "./types/index.js";
import { getBaseUrl, getApiKey, getConfig } from "./config.js";
import { USER_AGENT } from "./utils.js";

let cachedModels: Record<string, ModelConfig> | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function discoverModels(): Promise<Record<string, ModelConfig>> {
  const now = Date.now();
  if (cachedModels && now - cacheTime < CACHE_TTL_MS) {
    return cachedModels;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("[discovery] API key not set — skipping model discovery");
    return {};
  }

  try {
    const res = await fetch(`${getBaseUrl()}/v1/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": USER_AGENT,
      },
    });

    if (!res.ok) {
      console.warn(`[discovery] Failed to fetch models: ${res.status} ${res.statusText}`);
      return {};
    }

    const data = (await res.json()) as DiscoveryResponse;
    const discovered: Record<string, ModelConfig> = {};
    const defaults = getConfig().models;

    for (const model of data.data) {
      const id = model.id;
      // Skip models already defined in static config (defaults + user overrides)
      if (defaults[id]) continue;

      discovered[id] = { backend: "openai", endpoint: "/v1/chat/completions" };
    }

    cachedModels = discovered;
    cacheTime = now;
    return discovered;
  } catch (err) {
    console.warn("[discovery] Error fetching models:", err);
    return {};
  }
}

export function getDiscoveredModels(): Record<string, ModelConfig> | null {
  return cachedModels;
}
