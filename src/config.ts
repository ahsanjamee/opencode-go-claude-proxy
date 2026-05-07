import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import type { ProxyConfig, ModelConfig } from "./types/index.js";

const CONFIG_DIR = join(homedir(), ".opencode-proxy");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cachedConfig: ProxyConfig | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5000;

function loadDefaults(): ProxyConfig {
  const defaultsPath = join(__dirname, "..", "config", "defaults.json");
  return JSON.parse(readFileSync(defaultsPath, "utf-8")) as ProxyConfig;
}

function loadUserConfig(): ProxyConfig | null {
  const envPath = process.env.PROXY_CONFIG_PATH;
  const path = envPath && existsSync(envPath) ? envPath : existsSync(CONFIG_PATH) ? CONFIG_PATH : null;
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ProxyConfig;
  } catch {
    return null;
  }
}

const KNOWN_MODEL_PROPS = new Set(["backend", "endpoint", "baseurl"]);

function loadEnvOverrides(): Record<string, Partial<ModelConfig>> {
  const overrides: Record<string, Partial<ModelConfig>> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("PROXY_MODEL_") || !value) continue;
    // PROXY_MODEL_KIMI_K2_5_BACKEND=openai
    const parts = key.replace("PROXY_MODEL_", "").split("_");
    const last = parts[parts.length - 1].toLowerCase();
    if (!KNOWN_MODEL_PROPS.has(last)) continue;
    const modelId = parts.slice(0, -1).join("-").toLowerCase();
    if (!modelId) continue;
    if (!overrides[modelId]) overrides[modelId] = {};
    if (last === "backend") overrides[modelId].backend = value as any;
    if (last === "endpoint") overrides[modelId].endpoint = value;
    if (last === "baseurl") overrides[modelId].baseUrl = value;
  }
  return overrides;
}

export function getConfig(): ProxyConfig {
  const now = Date.now();
  if (cachedConfig && now - cacheTime < CACHE_TTL_MS) {
    return cachedConfig;
  }

  const defaults = loadDefaults();
  const user = loadUserConfig();
  const envOverrides = loadEnvOverrides();

  const merged: ProxyConfig = {
    models: { ...defaults.models },
    modelAliases: { ...defaults.modelAliases }, // ← was never propagated before
    global: { ...defaults.global },
  };

  if (user?.models) {
    for (const [id, cfg] of Object.entries(user.models)) {
      merged.models[id] = cfg;
    }
  }

  if (user?.overrides) {
    for (const [id, cfg] of Object.entries(user.overrides)) {
      merged.models[id] = { ...merged.models[id], ...cfg };
    }
  }

  // User aliases extend (and can override) the defaults
  if (user?.modelAliases) {
    merged.modelAliases = { ...merged.modelAliases, ...user.modelAliases };
  }

  for (const [id, cfg] of Object.entries(envOverrides)) {
    merged.models[id] = { ...merged.models[id], ...cfg };
  }

  if (user?.global) {
    merged.global = { ...merged.global, ...user.global };
  }

  cachedConfig = merged;
  cacheTime = now;
  return merged;
}

export function invalidateConfig(): void {
  cachedConfig = null;
  cacheTime = 0;
}

export function getBaseUrl(): string {
  return process.env.PROXY_BASE_URL || getConfig().global?.baseUrl || "https://opencode.ai/zen/go";
}

export function getTimeoutMs(): number {
  const env = process.env.PROXY_TIMEOUT_MS;
  if (env) return parseInt(env, 10);
  return getConfig().global?.timeoutMs || 60000;
}

export function getApiKey(): string {
  return process.env.OPENCODE_API_KEY || "";
}

export function getShowReasoning(): boolean {
  const env = process.env.PROXY_SHOW_REASONING;
  if (env !== undefined) return env === "true" || env === "1";
  return getConfig().global?.showReasoning || false;
}
