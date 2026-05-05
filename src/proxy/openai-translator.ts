import type { Context } from "hono";
import type { ResolvedRoute } from "../types/index.js";
import type {
  AnthropicRequest,
  AnthropicMessage,
  AnthropicTool,
  AnthropicThinkingBlock,
} from "../types/anthropic.js";
import type { OpenAIRequest, OpenAIMessage, OpenAITool, OpenAISSEChunk } from "../types/openai.js";
import { getTimeoutMs } from "../config.js";
import { mapFinishReason } from "../utils.js";

// ---------------------------------------------------------------------------
// Request transformation: Anthropic → OpenAI
// ---------------------------------------------------------------------------

function anthropicMessagesToOpenAI(messages: AnthropicMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    const textParts: string[] = [];
    const reasoningParts: string[] = [];
    const toolCalls: NonNullable<OpenAIMessage["tool_calls"]> = [];

    for (const block of msg.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "thinking") {
        // Preserve thinking blocks as reasoning_content for providers that need it
        const tb = block as AnthropicThinkingBlock;
        if (tb.thinking) reasoningParts.push(tb.thinking);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      } else if (block.type === "tool_result") {
        const content =
          typeof block.content === "string"
            ? block.content
            : block.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        result.push({ role: "tool", content, tool_call_id: block.tool_use_id });
      } else if (block.type === "image") {
        textParts.push(`[Image: ${block.source.media_type}]`);
      }
    }

    if (toolCalls.length > 0) {
      // content:null is valid here because tool_calls is present (OpenAI spec allows this)
      const openaiMsg: OpenAIMessage = {
        role: "assistant",
        content: textParts.length > 0 ? textParts.join("\n") : null,
        tool_calls: toolCalls,
      };
      if (reasoningParts.length > 0) openaiMsg.reasoning_content = reasoningParts.join("\n");
      result.push(openaiMsg);
    } else if (textParts.length > 0 || reasoningParts.length > 0) {
      // content MUST be a string when there are no tool_calls — "" is valid, null is not.
      // This case triggers when a message has only a thinking block (textParts empty).
      const openaiMsg: OpenAIMessage = {
        role: msg.role,
        content: textParts.join("\n"), // empty string "" is valid; null would be rejected
      };
      if (reasoningParts.length > 0) openaiMsg.reasoning_content = reasoningParts.join("\n");
      result.push(openaiMsg);
    } else if (msg.role === "assistant") {
      // Empty assistant message — must use "" not null (no tool_calls present)
      result.push({ role: "assistant", content: "" });
    }
  }

  return result;
}

function anthropicToolsToOpenAI(tools: AnthropicTool[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function anthropicSystemToOpenAI(system: AnthropicRequest["system"]): string | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return system;
  return system.map((s) => s.text).join("\n\n");
}

// OpenCode Go models support at most ~16 000 output tokens.
// Claude Code can send max_tokens ≥ 64 000 (extended-thinking budget) which
// causes "generation exceeded max tokens limit" errors from the upstream.
const UPSTREAM_MAX_TOKENS = 16000;

function buildOpenAIRequest(body: AnthropicRequest, resolvedModel: string): OpenAIRequest {
  const req: OpenAIRequest = {
    // Use the resolved model ID (e.g. "qwen3.6-plus") not the raw Claude model
    // name (e.g. "claude-haiku-4-5-20251001") which upstream doesn't support.
    model: resolvedModel,
    messages: anthropicMessagesToOpenAI(body.messages),
  };

  const system = anthropicSystemToOpenAI(body.system);
  if (system) req.messages.unshift({ role: "system", content: system });

  if (body.tools && body.tools.length > 0) req.tools = anthropicToolsToOpenAI(body.tools);

  // Cap max_tokens — never send more than the upstream model supports.
  const requestedMax = body.max_tokens ?? UPSTREAM_MAX_TOKENS;
  req.max_tokens = Math.min(requestedMax, UPSTREAM_MAX_TOKENS);

  if (body.temperature !== undefined) req.temperature = body.temperature;
  if (body.stop_sequences !== undefined) req.stop = body.stop_sequences;

  // Claude Code defaults to streaming
  req.stream = body.stream !== false;

  // body.thinking (extended thinking config) is intentionally NOT forwarded to
  // OpenAI-format backends — they don't understand it and may reject the request.

  return req;
}

// Prefer the real upstream tool call ID; fall back to a synthetic one.
function resolveToolId(upstreamId: string | undefined, index: number): string {
  if (upstreamId && upstreamId.trim() !== "") return upstreamId;
  return `toolu_${String(index).padStart(24, "0")}`;
}

// ---------------------------------------------------------------------------
// Streaming handler
// ---------------------------------------------------------------------------

export async function handleOpenAITranslation(
  c: Context,
  body: AnthropicRequest,
  route: ResolvedRoute,
  upstreamHeaders: Record<string, string>
): Promise<Response> {
  const url = `${route.baseUrl}${route.endpoint}`;
  // Build the request using the resolved model ID (not the raw Claude model name)
  const openAIReq = buildOpenAIRequest(body, route.resolvedModel);
  const isStream = openAIReq.stream !== false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(openAIReq),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      // Parse upstream error and re-wrap in Anthropic error format so Claude
      // Code can display it cleanly instead of crashing on unexpected JSON.
      let upstreamMsg = `Upstream error ${res.status}`;
      try {
        const errBody = await res.json() as any;
        upstreamMsg = errBody?.error?.message ?? errBody?.message ?? JSON.stringify(errBody);
      } catch {
        try { upstreamMsg = await res.text(); } catch { /* ignore */ }
      }
      console.error(`[proxy] upstream ${res.status}: ${upstreamMsg}`);
      return c.json(
        {
          type: "error",
          error: { type: "api_error", message: `Error from provider: ${upstreamMsg}` },
        },
        res.status as any
      );
    }

    if (!isStream || !res.body) {
      const data = await res.json();
      const { openAIResponseToAnthropic } = await import("./response-converter.js");
      return c.json(openAIResponseToAnthropic(data, body.model));
    }

    // -----------------------------------------------------------------------
    // Streaming translation
    // -----------------------------------------------------------------------
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(streamController) {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        // ----------- state ------------------------------------------------
        // contentIndex tracks the NEXT block index to use.
        // We open blocks (text/thinking/tool_use) and advance contentIndex.
        // Blocks are closed by emitting content_block_stop at their own index.
        let contentIndex = 0;
        let textBlockIdx = -1;     // index of currently-open text block (-1 = none)
        let thinkingBlockIdx = -1; // index of currently-open thinking block (-1 = none)
        // Maps OpenAI tool delta index → absolute Anthropic content-block index
        const toolBlockIdx = new Map<number, number>();
        // Maps OpenAI tool delta index → real tool call ID (from upstream or synthetic)
        const toolIdMap = new Map<number, string>();
        let pendingFinishReason: string | null = null;
        let buffer = "";
        let firstContentReceived = false;

        // -- keepalive: send SSE comments every 3 s so Claude Code doesn't
        //    time out while waiting for the first token from a slow model.
        let keepaliveHandle: ReturnType<typeof setInterval> | null = setInterval(() => {
          if (!firstContentReceived) {
            streamController.enqueue(encoder.encode(":keepalive\n\n"));
          }
        }, 3000);

        const stopKeepalive = () => {
          if (keepaliveHandle !== null) { clearInterval(keepaliveHandle); keepaliveHandle = null; }
        };

        const enqueue = (data: string) =>
          streamController.enqueue(encoder.encode(data));

        const sse = (type: string, payload: Record<string, unknown>) =>
          `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;

        // ----------- helpers ----------------------------------------------

        const closeBlockAt = (idx: number) => {
          enqueue(sse("content_block_stop", { type: "content_block_stop", index: idx }));
        };

        const openThinkingBlock = () => {
          thinkingBlockIdx = contentIndex++;
          enqueue(sse("content_block_start", {
            type: "content_block_start",
            index: thinkingBlockIdx,
            content_block: { type: "thinking", thinking: "" },
          }));
        };

        const openTextBlock = () => {
          textBlockIdx = contentIndex++;
          enqueue(sse("content_block_start", {
            type: "content_block_start",
            index: textBlockIdx,
            content_block: { type: "text", text: "" },
          }));
        };

        // ----------- message_start ----------------------------------------
        enqueue(sse("message_start", {
          type: "message_start",
          message: {
            id: `msg_${Date.now()}`,
            type: "message",
            role: "assistant",
            model: body.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }));

        // ----------- main stream loop -------------------------------------
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data: ")) continue;
              const jsonStr = trimmed.slice(6);
              if (jsonStr === "[DONE]") continue;

              let chunk: OpenAISSEChunk;
              try { chunk = JSON.parse(jsonStr) as OpenAISSEChunk; } catch { continue; }

              const choice = chunk.choices[0];
              if (!choice) continue;

              const rawContent   = choice.delta.content;
              const rawReasoning = choice.delta.reasoning || choice.delta.reasoning_content;

              // ---- reasoning / thinking content --------------------------
              if (rawReasoning != null && rawReasoning !== "") {
                firstContentReceived = true;
                stopKeepalive();

                if (thinkingBlockIdx === -1) {
                  // Close open text block if any
                  if (textBlockIdx !== -1) {
                    closeBlockAt(textBlockIdx);
                    textBlockIdx = -1;
                  }
                  openThinkingBlock();
                }

                enqueue(sse("content_block_delta", {
                  type: "content_block_delta",
                  index: thinkingBlockIdx,
                  delta: { type: "thinking_delta", thinking: rawReasoning },
                }));
              }

              // ---- text content ------------------------------------------
              if (rawContent != null && rawContent !== "") {
                firstContentReceived = true;
                stopKeepalive();

                if (textBlockIdx === -1) {
                  // Close open thinking block if any
                  if (thinkingBlockIdx !== -1) {
                    closeBlockAt(thinkingBlockIdx);
                    thinkingBlockIdx = -1;
                  }
                  openTextBlock();
                }

                enqueue(sse("content_block_delta", {
                  type: "content_block_delta",
                  index: textBlockIdx,
                  delta: { type: "text_delta", text: rawContent },
                }));
              }

              // ---- tool calls --------------------------------------------
              if (choice.delta.tool_calls) {
                firstContentReceived = true;
                stopKeepalive();

                // Close any open text/thinking block first
                if (textBlockIdx !== -1) {
                  closeBlockAt(textBlockIdx);
                  textBlockIdx = -1;
                }
                if (thinkingBlockIdx !== -1) {
                  closeBlockAt(thinkingBlockIdx);
                  thinkingBlockIdx = -1;
                }

                for (const tc of choice.delta.tool_calls) {
                  const tcIdx = tc.index ?? 0;

                  if (tc.function?.name && !toolBlockIdx.has(tcIdx)) {
                    // Open a new tool_use block, preferring the upstream's real tool ID
                    const blockIdx = contentIndex++;
                    toolBlockIdx.set(tcIdx, blockIdx);
                    const toolId = resolveToolId(tc.id, tcIdx);
                    toolIdMap.set(tcIdx, toolId);
                    enqueue(sse("content_block_start", {
                      type: "content_block_start",
                      index: blockIdx,
                      content_block: {
                        type: "tool_use",
                        id: toolId,
                        name: tc.function.name,
                        input: {},
                      },
                    }));
                  }

                  if (tc.function?.arguments && toolBlockIdx.has(tcIdx)) {
                    enqueue(sse("content_block_delta", {
                      type: "content_block_delta",
                      index: toolBlockIdx.get(tcIdx)!,
                      delta: { type: "input_json_delta", partial_json: tc.function.arguments },
                    }));
                  }
                }
              }

              if (choice.finish_reason) {
                pendingFinishReason = choice.finish_reason;
              }
            }
          }

          // ----------- end of stream: close all open blocks ---------------
          stopKeepalive();

          // Close open text/thinking block
          if (textBlockIdx !== -1)    closeBlockAt(textBlockIdx);
          if (thinkingBlockIdx !== -1) closeBlockAt(thinkingBlockIdx);

          // Close each tool_use block
          for (const [, blockIdx] of toolBlockIdx) {
            closeBlockAt(blockIdx);
          }

          // message_delta
          enqueue(sse("message_delta", {
            type: "message_delta",
            delta: {
              stop_reason: mapFinishReason(pendingFinishReason),
              stop_sequence: null,
            },
            usage: { output_tokens: 0 },
          }));

          // message_stop
          enqueue(sse("message_stop", { type: "message_stop" }));
          streamController.close();
        } catch (err) {
          stopKeepalive();
          streamController.error(err);
        } finally {
          reader.releaseLock();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
