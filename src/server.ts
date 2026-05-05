import { Hono } from "hono";
import type { Context } from "hono";
import { getApiKey, getBaseUrl } from "./config.js";
import { resolveRoute } from "./router.js";
import { handlePassthrough } from "./proxy/passthrough.js";
import { handleOpenAITranslation } from "./proxy/openai-translator.js";
import { handleAlibabaTranslation } from "./proxy/alibaba-translator.js";
import type { AnthropicRequest } from "./types/anthropic.js";
import { estimateTokenCount } from "./utils.js";

export function createServer(): Hono {
  const app = new Hono();

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
        400
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
        401
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
        400
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
        400
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
        400
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
      "User-Agent": "opencode-go-claude-proxy/1.0.0",
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
        400
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
        500
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
        401
      );
    }

    try {
      const res = await fetch(`${getBaseUrl()}/v1/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "opencode-go-claude-proxy/1.0.0",
        },
      });

      if (!res.ok) {
        return c.text(await res.text(), res.status as any);
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
        500
      );
    }
  });

  return app;
}
