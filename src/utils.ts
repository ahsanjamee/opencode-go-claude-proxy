export const USER_AGENT = "opencode-go-claude-proxy/1.1.0";

/**
 * Maps an OpenAI finish_reason to an Anthropic stop_reason.
 */
export function mapFinishReason(reason: string | null | undefined): string {
  switch (reason) {
    case "tool_calls":
      return "tool_use";
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "end_turn";
    default:
      return "end_turn";
  }
}

/**
 * Rough token count estimate (~4 chars per token).
 * Used for the /v1/messages/count_tokens endpoint when no proper
 * tokenizer is available.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extracts a human-readable error message from an upstream error response.
 * Tries JSON (OpenAI/Anthropic error format) first, falls back to plain text.
 */
export async function extractUpstreamErrorMessage(res: Response): Promise<string> {
  try {
    const errBody = (await res.json()) as Record<string, unknown>;
    return (errBody?.error as any)?.message
      ?? (errBody as any)?.message
      ?? JSON.stringify(errBody);
  } catch {
    try {
      return await res.text();
    } catch {
      return `Upstream error ${res.status}`;
    }
  }
}
