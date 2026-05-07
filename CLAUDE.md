# CLAUDE.md — opencode-go-claude-proxy

This file is read by AI agents (Claude Code, Copilot, Gemini, etc.) to understand
this codebase before making changes. Read it completely before editing any file.

---

## What this project does

`opencode-go-claude-proxy` is an **Anthropic Messages API–compatible HTTP proxy** that sits
between **Claude Code CLI** and **OpenCode Go** (a $5/month subscription that gives access to
Kimi, GLM, DeepSeek, MiniMax, Qwen, and MiMo models).

```
Claude Code CLI  →  this proxy (port 3456)  →  OpenCode Go API
                 Anthropic format          OpenAI format
```

Claude Code thinks it is talking to Anthropic. The proxy:
1. Accepts Anthropic `POST /v1/messages` requests.
2. Translates them to OpenAI Chat Completions format.
3. Forwards to OpenCode Go's OpenAI-compatible endpoint.
4. Translates the response (streaming SSE or full JSON) back to Anthropic format.
5. Returns to Claude Code as if it came from Anthropic.

Some models (MiniMax M2.x) use the Anthropic format natively and are passed through
without translation.

---

## Architecture

```
src/
  index.ts            CLI entry-point (arg parsing, port, api-key, start server)
  config.ts           Runtime config: API key, base URL, timeout, showReasoning flag
  server.ts           Hono router — all HTTP routes live here
  router.ts           Model-ID → backend resolution (openai / anthropic / alibaba)
  discovery.ts        Dynamic model list fetching from OpenCode Go
  utils.ts            Shared helpers: mapFinishReason(), estimateTokenCount()

  proxy/
    openai-translator.ts   Main translation engine for OpenAI-format backends
                           Handles BOTH streaming SSE and non-streaming responses
    response-converter.ts  Non-streaming OpenAI → Anthropic response conversion
    passthrough.ts         Direct passthrough for Anthropic-native backends (MiniMax)
    alibaba-translator.ts  Alibaba-compatible backend translation

  types/
    anthropic.ts      Full Anthropic Messages API type definitions
    openai.ts         OpenAI Chat Completions type definitions
    index.ts          Shared types (ResolvedRoute, etc.)

config/
  config.example.json  Example config file users copy to config.json
  config.json          (git-ignored) live config with API key

.github/
  workflows/
    ci.yml       Runs on every push/PR: install → build → verify
    release.yml  Runs on version tags: build binaries + GitHub Release
```

---

## Critical implementation details

### SSE streaming format (MOST IMPORTANT)

Claude Code is strict about Anthropic's SSE event sequence. Every streaming response
**must** follow this exact lifecycle:

```
event: message_start      ← always first, includes message envelope
event: content_block_start ← one per block (text / thinking / tool_use)
event: content_block_delta ← zero or more per block
event: content_block_stop  ← closes the block; index must match the start
event: message_delta       ← stop_reason + usage
event: message_stop        ← always last
```

**Block index management** (`openai-translator.ts`):
- `contentIndex` is a monotonically increasing counter.
- `textBlockIdx`, `thinkingBlockIdx` — track the index of the currently-open text or
  thinking block (`-1` = none open).
- `toolBlockIdx` — a `Map<tcIndex, absoluteBlockIndex>` for tool_use blocks.
- Blocks are opened lazily (first delta triggers `content_block_start`).
- A block must be closed with `content_block_stop` at **its own index** before a
  different block type can be opened.

### Delta types

| Content type | `content_block_start` type | Delta `type`       | Delta payload field |
|--------------|----------------------------|--------------------|---------------------|
| Text         | `"text"`                   | `"text_delta"`     | `text`              |
| Reasoning    | `"thinking"`               | `"thinking_delta"` | `thinking`          |
| Tool args    | `"tool_use"`               | `"input_json_delta"` | `partial_json`    |

> **`input_json_delta` is NOT `partial_json`** — the `type` field must be
> `"input_json_delta"`. Using the wrong value silently breaks all tool/skill features.

### Reasoning / thinking blocks

OpenCode Go models return `reasoning_content` (or `reasoning`) in their delta objects
for thinking models (DeepSeek, GLM). This must be converted to Anthropic `thinking`
content blocks — **never** shown as text. See `openai-translator.ts` for the state machine.

Anthropic `thinking` blocks in **incoming** assistant messages (from Claude Code's
conversation history) must be mapped back to `reasoning_content` on the OpenAI request
so DeepSeek/Kimi can continue multi-turn thinking conversations.

### stop_reason mapping

| OpenAI `finish_reason` | Anthropic `stop_reason` |
|------------------------|-------------------------|
| `"stop"`               | `"end_turn"`            |
| `"tool_calls"`         | `"tool_use"`            |
| `"length"`             | `"max_tokens"`          |
| `"content_filter"`     | `"end_turn"`            |
| anything else          | `"end_turn"`            |

The helper `mapFinishReason()` in `src/utils.ts` handles this.

### Keepalive

Claude Code times out after ~6 seconds of no data. The proxy sends SSE comment lines
(`:keepalive\n\n`) every 3 seconds while waiting for the first token from the upstream
model. These are ignored by the SSE parser but keep the TCP connection alive.

### /v1/messages/count_tokens

Claude Code calls this before sending requests to estimate context size. The proxy returns
an approximation (~4 chars/token) since OpenCode Go has no native token-counting endpoint.
This is close enough for Claude Code's context management; inaccuracies don't cause failures.

### `thinking` field stripping

Claude Code sends `thinking: { type: "enabled", budget_tokens: N }` in requests when
extended thinking is enabled. This field is **never** forwarded to OpenAI-format backends —
they don't understand it and may reject the request with 400.

---

## Key files to read before changing

| Change | Files to read first |
|--------|---------------------|
| Streaming SSE behaviour | `src/proxy/openai-translator.ts`, `src/types/anthropic.ts` |
| Non-streaming response shape | `src/proxy/response-converter.ts` |
| Route / model routing | `src/router.ts`, `src/config.ts` |
| Adding a new endpoint | `src/server.ts` |
| Anthropic ↔ OpenAI type definitions | `src/types/anthropic.ts`, `src/types/openai.ts` |
| Token counting | `src/utils.ts` |

---

## Build & run

```bash
# Setup
cp .env.example .env
# Edit .env and add your API key

# Development (hot-reload via tsx)
npm run dev

# Production build
npm run build
npm start

# Docker
docker build -t opencode-proxy .
docker run -p 3456:3456 --env-file .env opencode-proxy
```

### CLI flags

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `--api-key` | `OPENCODE_API_KEY` | — | OpenCode Go API key (required) |
| `--port` | `PORT` | `3456` | Listen port |
| `--base-url` | `OPENCODE_BASE_URL` | `https://opencode.ai/zen/go/v1` | Upstream base URL |

### Configure Claude Code

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:3456
export ANTHROPIC_AUTH_TOKEN=unused
# Recommended: disable experimental betas to avoid 400 errors
export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
claude
```

---

## Backend types

| `route.backend` | Translator used | Notes |
|-----------------|-----------------|-------|
| `"openai"` | `openai-translator.ts` | Most models (Kimi, GLM, DeepSeek, Qwen, MiMo) |
| `"anthropic"` | `passthrough.ts` | MiniMax M2.x (native Anthropic format) |
| `"alibaba"` | `alibaba-translator.ts` | Alibaba Tongyi models |

---

## Common mistakes to avoid

1. **Never emit `{ type: "partial_json" }` as a delta type** — it must be `"input_json_delta"`.
2. **Never mix reasoning content into text blocks** — reasoning must always be a `thinking` block.
3. **Never omit `content_block_stop`** for any block that was started.
4. **Never forward `body.thinking`** (Claude Code's extended thinking config) to OpenAI backends.
5. **Always use `mapFinishReason()`** — never hard-code `"end_turn"` or pass OpenAI reasons through.
6. **Tool block indices must match** — the `index` in `content_block_stop` must equal the `index` in the corresponding `content_block_start`.

