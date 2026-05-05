export type BackendType = "anthropic" | "openai" | "alibaba";

export interface ModelConfig {
  backend: BackendType;
  endpoint: string;
  /** Optional per-model base URL override. Falls back to global baseUrl if not set. */
  baseUrl?: string;
}

export interface ProxyConfig {
  models: Record<string, ModelConfig>;
  overrides?: Record<string, Partial<ModelConfig>>;
  /**
   * Maps incoming model IDs to OpenCode Go model IDs.
   * Supports wildcard suffix matching: "claude-haiku-*" matches any model
   * whose ID starts with "claude-haiku-".
   * Exact matches are checked first, then wildcard patterns.
   * Example: { "claude-haiku-*": "qwen3.5-plus", "claude-sonnet-*": "qwen3.6-plus" }
   */
  modelAliases?: Record<string, string>;
  global?: {
    baseUrl?: string;
    timeoutMs?: number;
    showReasoning?: boolean;
    /**
     * Fallback model used for any incoming model ID that has no explicit
     * mapping and is not found in the discovered model list.
     * Defaults to "qwen3.6-plus" if not set.
     */
    defaultModel?: string;
  };
}

export interface ResolvedRoute {
  backend: BackendType;
  endpoint: string;
  baseUrl: string;
  /** The resolved OpenCode Go model ID sent to the upstream */
  resolvedModel: string;
}

export interface DiscoveryModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface DiscoveryResponse {
  object: string;
  data: DiscoveryModel[];
}
