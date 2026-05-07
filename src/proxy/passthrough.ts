import type { Context } from "hono";
import { stream } from "hono/streaming";
import type { ResolvedRoute } from "../types/index.js";
import type { AnthropicRequest } from "../types/anthropic.js";
import { getTimeoutMs } from "../config.js";
import { extractUpstreamErrorMessage } from "../utils.js";

export async function handlePassthrough(
  c: Context,
  body: AnthropicRequest,
  route: ResolvedRoute,
  upstreamHeaders: Record<string, string>,
): Promise<Response> {
  const url = `${route.baseUrl}${route.endpoint}`;
  const isStream = body.stream !== false;

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

    if (!res.ok) {
      clearTimeout(timeoutId);
      const upstreamMsg = await extractUpstreamErrorMessage(res);
      console.error(`[passthrough] upstream ${res.status}: ${upstreamMsg}`);
      return c.json(
        {
          type: "error",
          error: { type: "api_error", message: `Error from provider: ${upstreamMsg}` },
        },
        res.status as any,
      );
    }

    if (!isStream || !res.body) {
      clearTimeout(timeoutId);
      return c.json(await res.json());
    }

    // Stream SSE back directly — MiniMax already returns Anthropic-format SSE
    return stream(c, async (streamCtx) => {
      const reader = res.body!.getReader();
      try {
        while (true) {
          if (controller.signal.aborted) break;

          const { done, value } = await reader.read();
          if (done) break;
          await streamCtx.write(value);
        }
      } finally {
        clearTimeout(timeoutId);
        reader.releaseLock();
      }
    });
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
