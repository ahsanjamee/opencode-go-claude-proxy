import type { Context } from "hono";
import type { ResolvedRoute } from "../types/index.js";
import type { AnthropicRequest } from "../types/anthropic.js";
import { handleOpenAITranslation } from "./openai-translator.js";

// Alibaba (Qwen) uses an OpenAI-compatible API with minor differences.
// For v1, we reuse the OpenAI translator. Future iterations can add Alibaba-specific quirks.
export async function handleAlibabaTranslation(
  c: Context,
  body: AnthropicRequest,
  route: ResolvedRoute,
  upstreamHeaders: Record<string, string>
): Promise<Response> {
  return handleOpenAITranslation(c, body, route, upstreamHeaders);
}
