import type { ResolvedRoute, ModelConfig } from "./types/index.js";
import { getConfig, getBaseUrl } from "./config.js";
import { discoverModels, getDiscoveredModels } from "./discovery.js";

const DEFAULT_FALLBACK_MODEL = "qwen3.6-plus";

/**
 * Resolve an incoming model alias.
 * Checks exact matches first, then wildcard suffix patterns ("claude-haiku-*").
 * Returns the mapped model ID, or null if no alias is configured.
 */
function resolveAlias(
  modelId: string,
  aliases: Record<string, string> | undefined
): string | null {
  if (!aliases) return null;

  // 1. Exact match
  if (aliases[modelId]) return aliases[modelId];

  // 2. Wildcard suffix match ("claude-haiku-*" matches "claude-haiku-4-5-20251001")
  for (const [pattern, target] of Object.entries(aliases)) {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1); // remove trailing *
      if (modelId.startsWith(prefix)) return target;
    }
  }

  return null;
}

export async function resolveRoute(modelId: string): Promise<ResolvedRoute | null> {
  const config = getConfig();
  const baseUrl = getBaseUrl();

  // ---- Step 1: resolve alias (e.g. claude-haiku-* → qwen3.5-plus) ----
  let aliasedModelId = resolveAlias(modelId, config.modelAliases) ?? modelId;

  // ---- Safety net: any claude-* model that slipped through alias resolution
  // is automatically redirected to defaultModel. Claude Code uses models like
  // "claude-haiku-4-5-20251001" internally; OpenCode Go doesn't support them.
  const defaultModel = config.global?.defaultModel ?? DEFAULT_FALLBACK_MODEL;
  if (aliasedModelId === modelId && modelId.startsWith("claude-")) {
    aliasedModelId = defaultModel;
  }

  if (aliasedModelId !== modelId) {
    console.log(`[router] alias: ${modelId} → ${aliasedModelId}`);
  }

  // ---- Step 2: user config (static mapping) ----
  if (config.models[aliasedModelId]) {
    const cfg = config.models[aliasedModelId];
    return {
      backend: cfg.backend,
      endpoint: cfg.endpoint,
      baseUrl: cfg.baseUrl ?? baseUrl, // per-model baseUrl overrides global
      resolvedModel: aliasedModelId,
    };
  }

  // ---- Step 3: discovered models from OpenCode Go ----
  const discovered = getDiscoveredModels() || (await discoverModels());
  if (discovered[aliasedModelId]) {
    const cfg = discovered[aliasedModelId];
    return {
      backend: cfg.backend,
      endpoint: cfg.endpoint,
      baseUrl: cfg.baseUrl ?? baseUrl,
      resolvedModel: aliasedModelId,
    };
  }

  // ---- Step 4: defaultModel catch-all ----
  // If still unknown, fall back to the configured defaultModel.
  if (aliasedModelId !== defaultModel) {
    console.warn(
      `[router] unknown model "${aliasedModelId}" — falling back to "${defaultModel}"`
    );
  }

  // Try to resolve the default model's route
  if (config.models[defaultModel]) {
    const cfg = config.models[defaultModel];
    return { backend: cfg.backend, endpoint: cfg.endpoint, baseUrl, resolvedModel: defaultModel };
  }

  const discoveredDefault = discovered[defaultModel];
  if (discoveredDefault) {
    return {
      backend: discoveredDefault.backend,
      endpoint: discoveredDefault.endpoint,
      baseUrl,
      resolvedModel: defaultModel,
    };
  }

  // Last resort: send as openai with the default model name
  return {
    backend: "openai",
    endpoint: "/v1/chat/completions",
    baseUrl,
    resolvedModel: defaultModel,
  };
}
