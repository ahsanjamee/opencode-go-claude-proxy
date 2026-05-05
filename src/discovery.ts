import type { DiscoveryResponse, ModelConfig } from "./types/index.js";
import { getBaseUrl, getApiKey } from "./config.js";

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
    return {};
  }

  try {
    const res = await fetch(`${getBaseUrl()}/v1/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "opencode-go-claude-proxy/1.0.0",
      },
    });

    if (!res.ok) {
      console.warn(`[discovery] Failed to fetch models: ${res.status} ${res.statusText}`);
      return {};
    }

    const data = (await res.json()) as DiscoveryResponse;
    const discovered: Record<string, ModelConfig> = {};

    for (const model of data.data) {
      const id = model.id;
      // Skip if already in defaults (we trust defaults more)
      if (cachedModels?.[id]) continue;

      // Heuristic: models not in defaults default to openai
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
