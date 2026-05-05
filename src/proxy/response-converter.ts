import type {
  AnthropicContentBlock,
  AnthropicToolUseBlock,
  AnthropicThinkingBlock,
} from "../types/anthropic.js";
import type { OpenAIResponse } from "../types/openai.js";
import { mapFinishReason } from "../utils.js";

export function openAIResponseToAnthropic(
  openAIRes: OpenAIResponse,
  model: string
): Record<string, unknown> {
  const message = openAIRes.choices[0]?.message;
  if (!message) {
    return {
      id: openAIRes.id,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: openAIRes.usage?.prompt_tokens || 0,
        output_tokens: openAIRes.usage?.completion_tokens || 0,
      },
    };
  }

  const content: AnthropicContentBlock[] = [];

  // Reasoning content → proper Anthropic thinking block (not user-visible text)
  const reasoning = message.reasoning || message.reasoning_content;
  if (reasoning) {
    content.push({
      type: "thinking",
      thinking: reasoning,
      signature: "",
    } as AnthropicThinkingBlock);
  }

  // Tool calls → tool_use blocks
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      try {
        const input = JSON.parse(tc.function.arguments);
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        } as AnthropicToolUseBlock);
      } catch {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: {},
        } as AnthropicToolUseBlock);
      }
    }
  }

  // Text content → text block
  if (message.content != null && message.content !== "") {
    content.push({ type: "text", text: message.content });
  }

  // Ensure at least one block
  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  const finishReason = openAIRes.choices[0]?.finish_reason;

  return {
    id: openAIRes.id,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: mapFinishReason(finishReason),
    stop_sequence: null,
    usage: {
      input_tokens: openAIRes.usage?.prompt_tokens || 0,
      output_tokens: openAIRes.usage?.completion_tokens || 0,
    },
  };
}
