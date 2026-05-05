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
