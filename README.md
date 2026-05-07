# opencode-go-claude-proxy

> Use your [OpenCode Go](https://opencode.ai/docs/go/) subscription with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI.

```
Claude Code CLI  ─── Anthropic format ──▶  opencode-go-proxy :3456  ─── OpenAI format ──▶  OpenCode Go
                 ◀── Anthropic format ───                            ◀── OpenAI format ────
```

Claude Code thinks it's talking to Anthropic. Your requests silently route through OpenCode Go's affordable open models instead.

---

## Why?

OpenCode Go gives access to powerful coding models (Kimi K2, GLM-5, DeepSeek V4, MiniMax, Qwen) for **$5/month** (then $10/month). This proxy makes them work seamlessly with Claude Code — no patches, no forks.

---

## Quickstart (choose one method)

### Method 1 — Docker (local build)

1. Clone the repository:
   ```bash
   git clone https://github.com/ahsanjamee/opencode-go-claude-proxy.git
   cd opencode-go-claude-proxy
   ```

2. Build the image:
   ```bash
   docker build -t opencode-proxy .
   ```

3. Run the proxy (passing your API key):
   ```bash
   docker run -d --name proxy -p 3456:3456 -e OPENCODE_API_KEY=sk-YOUR-KEY opencode-proxy
   ```

---

### Method 2 — Run from Source (Node.js)

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/ahsanjamee/opencode-go-claude-proxy.git
   cd opencode-go-claude-proxy
   npm install
   ```

2. Create an `.env` file from the example:
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` and add your `OPENCODE_API_KEY`.*

3. Start the proxy:
   ```bash
   # For development (hot-reload):
   npm run dev
   
   # For production:
   npm run build
   npm start
   ```

---

## Step 2 — Configure Claude Code to use the proxy

Create or edit the Claude Code settings file (usually at `~/.claude/settings.json`) to point it to the proxy:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3456",
    "ANTHROPIC_AUTH_TOKEN": "sk-test",
    "ANTHROPIC_API_KEY": "",
    "ANTHROPIC_MODEL": "deepseek-v4-pro"
  },
  "theme": "dark-ansi",
  "effortLevel": "high"
}
```

> **Tip:** You can change `ANTHROPIC_MODEL` to any model listed in the [Supported Models](#supported-models) table (like `minimax-m2.7` or `deepseek-v4-pro`). The proxy will automatically route your requests to the correct backend.

---



## All CLI flags

| Flag | Environment variable | Default | Description |
|------|---------------------|---------|-------------|
| `--api-key <key>` | `OPENCODE_API_KEY` | — | **Required.** Your OpenCode Go API key |
| `--port <number>` | `PORT` | `3456` | Port to listen on |
| `--base-url <url>` | `PROXY_BASE_URL` | `https://opencode.ai/zen/go/v1` | Upstream base URL |
| `--timeout <ms>` | `PROXY_TIMEOUT_MS` | `60000` | Request timeout |
| `--config <path>` | `PROXY_CONFIG_PATH` | — | Path to `config.json` |
| `--help` | — | — | Show help |

---

## Supported models

| Model | Backend |
|-------|---------|
| `kimi-k2.6`, `kimi-k2.5` | OpenAI compat |
| `glm-5.1`, `glm-5` | OpenAI compat (thinking) |
| `deepseek-v4-pro`, `deepseek-v4-flash` | OpenAI compat (thinking) |
| `qwen3.6-plus`, `qwen3.5-plus` | Alibaba compat |
| `mimo-v2-pro`, `mimo-v2-omni` | OpenAI compat |
| `minimax-m2.7`, `minimax-m2.5` | Anthropic native (long context) |

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/messages` | Main chat endpoint |
| `POST` | `/v1/messages/count_tokens` | Token count estimate |
| `GET` | `/v1/models` | Available model list |
| `GET` | `/health` | Health check |

---

## Troubleshooting

**Error: OPENCODE_API_KEY is required**  
→ The key must be passed as `--api-key sk-...` or via the `OPENCODE_API_KEY` env var.  
→ When using `npm run start`, you must use `-- --api-key sk-...` (double dash before flags).

**Tools/skills not working in Claude Code**  
→ Ensure you're on v1.1.0+. Earlier versions had a wrong SSE delta type that broke all tools.

**Reasoning text showing in Claude Code output**  
→ Ensure you're on v1.1.0+. Reasoning is now properly emitted as hidden `thinking` blocks.

**400 errors from beta headers**  
→ Set `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` before running `claude`.

**Stream times out**  
→ The proxy sends keepalive SSE comments every 3 s. If still timing out, the model is overloaded — try a different model.

---

## What gets translated

### Anthropic → OpenAI (outgoing request)

| Anthropic | OpenAI |
|-----------|--------|
| `system` string/block array | `messages[0]` with `role: "system"` |
| Text content blocks | `content` string |
| `thinking` blocks | `reasoning_content` |
| `tool_use` blocks | `tool_calls` |
| `tool_result` blocks | messages with `role: "tool"` |

### OpenAI → Anthropic (incoming response)

| OpenAI | Anthropic |
|--------|-----------|
| `finish_reason: "stop"` | `stop_reason: "end_turn"` |
| `finish_reason: "tool_calls"` | `stop_reason: "tool_use"` |
| `finish_reason: "length"` | `stop_reason: "max_tokens"` |
| `delta.content` text | `text_delta` in `content_block_delta` |
| `delta.reasoning_content` | `thinking_delta` in `content_block_delta` |
| `delta.tool_calls[].function.arguments` | `input_json_delta` in `content_block_delta` |

---

## Automatic Model Mapping

Claude Code internally uses `claude-*` models (like `claude-haiku-*` for background tasks). OpenCode Go doesn't natively support these IDs. 

The proxy **automatically maps** all Claude models to their closest OpenCode equivalents:
- `claude-haiku-*` → `qwen3.5-plus`
- `claude-sonnet-*` → `qwen3.6-plus`
- `claude-opus-*` → `qwen3.6-plus`

If Claude Code requests an entirely unknown model, it safely falls back to `qwen3.6-plus` to prevent 401/400 crashes.

### Customizing aliases

You can override these mappings by editing `~/.opencode-proxy/config.json`:

```json
{
  "modelAliases": {
    "claude-haiku-*": "kimi-k2.5",
    "claude-sonnet-*": "deepseek-v4-pro"
  },
  "global": {
    "defaultModel": "kimi-k2.5"
  }
}
```


---

## License

MIT

---

#### Disclaimer
*This project is an unofficial community tool and is not affiliated with, endorsed by, or associated with Anthropic or OpenCode Go. Use it at your own risk.*

#### Credits
Created with ❤️ by [ahsanjamee](https://github.com/ahsanjamee).
