import type { Context } from "hono";
import { stream } from "hono/streaming";
import type { ResolvedRoute } from "../types/index.js";
import type { AnthropicRequest } from "../types/anthropic.js";
import { getTimeoutMs } from "../config.js";

export async function handlePassthrough(
  c: Context,
  body: AnthropicRequest,
  route: ResolvedRoute,
  upstreamHeaders: Record<string, string>
): Promise<Response> {
  const url = `${route.baseUrl}${route.endpoint}`;
  const isStream = body.stream !== false;

  // Ensure the model field in the body matches the resolved model
  // (e.g. if aliasing redirected "claude-sonnet-*" → "minimax-m2.7")
  const forwardBody: AnthropicRequest = {
    ...body,
    model: route.resolvedModel,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(forwardBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      // Wrap error in Anthropic format (same as openai-translator.ts)
      let upstreamMsg = `Upstream error ${res.status}`;
      try {
        const errBody = await res.json() as any;
        upstreamMsg = errBody?.error?.message ?? errBody?.message ?? JSON.stringify(errBody);
      } catch {
        try { upstreamMsg = await res.text(); } catch { /* ignore */ }
      }
      console.error(`[passthrough] upstream ${res.status}: ${upstreamMsg}`);
      return c.json(
        {
          type: "error",
          error: { type: "api_error", message: `Error from provider: ${upstreamMsg}` },
        },
        res.status as any
      );
    }

    if (!isStream || !res.body) {
      return c.json(await res.json());
    }

    // Stream SSE back directly — MiniMax already returns Anthropic-format SSE
    return stream(c, async (streamCtx) => {
      const reader = res.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await streamCtx.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    });
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
