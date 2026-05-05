// Anthropic Messages API types

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicImageBlock
  | AnthropicThinkingBlock;

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | AnthropicContentBlock[];
  is_error?: boolean;
}

export interface AnthropicImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicSystemBlock {
  type: "text";
  text: string;
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: AnthropicSystemBlock[] | string;
  tools?: AnthropicTool[];
  max_tokens?: number;
  temperature?: number;
  stop_sequences?: string[];
  stream?: boolean;
  thinking?: { type: "enabled"; budget_tokens: number };
}

// SSE Events

export interface AnthropicSSEEvent {
  type: string;
}

export interface AnthropicMessageStartEvent extends AnthropicSSEEvent {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    model: string;
    content: AnthropicContentBlock[];
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: { input_tokens: number; output_tokens: number };
  };
}

export interface AnthropicContentBlockStartEvent extends AnthropicSSEEvent {
  type: "content_block_start";
  index: number;
  content_block: AnthropicContentBlock;
}

export interface AnthropicContentBlockDeltaEvent extends AnthropicSSEEvent {
  type: "content_block_delta";
  index: number;
  delta: AnthropicTextDelta | AnthropicThinkingDelta | AnthropicInputJsonDelta;
}

export interface AnthropicTextDelta {
  type: "text_delta";
  text: string;
}

export interface AnthropicThinkingDelta {
  type: "thinking_delta";
  thinking: string;
}

/** The correct delta type for streaming tool arguments. */
export interface AnthropicInputJsonDelta {
  type: "input_json_delta";
  partial_json: string;
}

export interface AnthropicContentBlockStopEvent extends AnthropicSSEEvent {
  type: "content_block_stop";
  index: number;
}

export interface AnthropicMessageDeltaEvent extends AnthropicSSEEvent {
  type: "message_delta";
  delta: {
    stop_reason: string | null;
    stop_sequence: string | null;
  };
  usage: { output_tokens: number };
}

export interface AnthropicMessageStopEvent extends AnthropicSSEEvent {
  type: "message_stop";
}

export interface AnthropicErrorEvent extends AnthropicSSEEvent {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

export type AnthropicResponseStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent;
