import { Hono } from "hono";
import type { Context, Next } from "hono";
import { getApiKey, getBaseUrl } from "./config.js";
import { resolveRoute } from "./router.js";
import { handlePassthrough } from "./proxy/passthrough.js";
import { handleOpenAITranslation } from "./proxy/openai-translator.js";
import { handleAlibabaTranslation } from "./proxy/alibaba-translator.js";
import type { AnthropicRequest } from "./types/anthropic.js";
import { estimateTokenCount, USER_AGENT, extractUpstreamErrorMessage } from "./utils.js";

// ---------------------------------------------------------------------------
// Middleware: rate limiter (sliding window, per-IP)
// ---------------------------------------------------------------------------
const RATE_LIMIT = 200;       // requests per window
const RATE_WINDOW_MS = 60000; // 1 minute
const rateCounts = new Map<string, { count: number; resetAt: number }>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateCounts) {
    if (now >= entry.resetAt) rateCounts.delete(key);
  }
}, 300_000).unref();

function rateLimiter(): (c: Context, next: Next) => Promise<void | Response> {
  return async (c, next) => {
    const ip = c.req.raw.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || c.req.raw.headers.get("x-real-ip")
      || "127.0.0.1";
    const now = Date.now();
    const entry = rateCounts.get(ip);

    if (entry && now < entry.resetAt) {
      if (entry.count >= RATE_LIMIT) {
        return c.json(
          { type: "error", error: { type: "rate_limit_error", message: "Too many requests" } },
          429,
        );
      }
      entry.count++;
    } else {
      rateCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    }

    await next();
  };
}

// ---------------------------------------------------------------------------
// Middleware: body size limit (10 MB max)
// ---------------------------------------------------------------------------
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

function bodySizeLimit(): (c: Context, next: Next) => Promise<void | Response> {
  return async (c, next) => {
    const contentLength = c.req.raw.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return c.json(
        { type: "error", error: { type: "invalid_request_error", message: "Request body too large" } },
        413,
      );
    }
    await next();
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function createServer(): Hono {
  const app = new Hono();

  // Apply global middleware
  app.use("*", rateLimiter());
  app.use("*", bodySizeLimit());

  app.get("/health", (c) => c.json({ status: "ok" }));

  // -------------------------------------------------------------------------
  // POST /v1/messages/count_tokens
  // Claude Code uses this to estimate context size before sending a request.
  // Since OpenCode Go has no native token-counting endpoint we return an
  // approximation (~4 chars per token) so Claude Code never hard-errors.
  // -------------------------------------------------------------------------
  app.post("/v1/messages/count_tokens", async (c: Context) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { type: "error", error: { type: "invalid_request_error", message: "Invalid JSON body" } },
        400,
      );
    }

    // Estimate tokens from the serialised request (all messages, system, tools)
    const rawText = JSON.stringify(body);
    const inputTokens = estimateTokenCount(rawText);

    return c.json({ input_tokens: inputTokens });
  });

  // -------------------------------------------------------------------------
  // POST /v1/messages
  // -------------------------------------------------------------------------
  app.post("/v1/messages", async (c: Context) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return c.json(
        {
          type: "error",
          error: {
            type: "authentication_error",
            message: "OPENCODE_API_KEY is not set. Please set it via environment variable or --api-key flag.",
          },
        },
        401,
      );
    }

    let body: AnthropicRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "Invalid JSON body",
          },
        },
        400,
      );
    }

    const modelId = body.model;
    if (!modelId) {
      return c.json(
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "Missing 'model' field in request body",
          },
        },
        400,
      );
    }

    const route = await resolveRoute(modelId);
    if (!route) {
      return c.json(
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: `Unknown model: ${modelId}`,
          },
        },
        400,
      );
    }

    const resolvedLabel = route.resolvedModel !== modelId
      ? `${modelId} → ${route.resolvedModel}`
      : modelId;
    console.log(`[proxy] model=${resolvedLabel} backend=${route.backend} endpoint=${route.endpoint}`);

    const upstreamHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "x-api-key": apiKey, // Anthropic backends require this instead of Bearer
      "User-Agent": USER_AGENT,
    };

    // Forward anthropic-beta header (let backend reject unsupported ones)
    const betaHeader = c.req.raw.headers.get("anthropic-beta");
    if (betaHeader) {
      upstreamHeaders["anthropic-beta"] = betaHeader;
    }

    // Forward anthropic-version header for Anthropic-native backends (e.g. MiniMax)
    const versionHeader = c.req.raw.headers.get("anthropic-version");
    if (versionHeader) {
      upstreamHeaders["anthropic-version"] = versionHeader;
    }

    try {
      if (route.backend === "anthropic") {
        return await handlePassthrough(c, body, route, upstreamHeaders);
      } else if (route.backend === "openai") {
        return await handleOpenAITranslation(c, body, route, upstreamHeaders);
      } else if (route.backend === "alibaba") {
        return await handleAlibabaTranslation(c, body, route, upstreamHeaders);
      }

      return c.json(
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: `Unsupported backend: ${route.backend}`,
          },
        },
        400,
      );
    } catch (err) {
      console.error("[proxy] Error:", err);
      return c.json(
        {
          type: "error",
          error: {
            type: "api_error",
            message: err instanceof Error ? err.message : "Unknown error",
          },
        },
        500,
      );
    }
  });

  // -------------------------------------------------------------------------
  // GET /v1/models  — proxy to OpenCode model list
  // -------------------------------------------------------------------------
  app.get("/v1/models", async (c) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return c.json(
        {
          type: "error",
          error: {
            type: "authentication_error",
            message: "OPENCODE_API_KEY is not set.",
          },
        },
        401,
      );
    }

    try {
      const res = await fetch(`${getBaseUrl()}/v1/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": USER_AGENT,
        },
      });

      if (!res.ok) {
        const msg = await extractUpstreamErrorMessage(res);
        return c.json(
          { type: "error", error: { type: "api_error", message: msg } },
          res.status as any,
        );
      }

      return c.json(await res.json());
    } catch (err) {
      return c.json(
        {
          type: "error",
          error: {
            type: "api_error",
            message: err instanceof Error ? err.message : "Unknown error",
          },
        },
        500,
      );
    }
  });

  return app;
}
