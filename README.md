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

### Method 1 — npx (no install, simplest)

```bash
# Linux / macOS
OPENCODE_API_KEY=sk-YOUR-KEY npx opencode-go-claude-proxy

# Windows (PowerShell)
$env:OPENCODE_API_KEY="sk-YOUR-KEY"; npx opencode-go-claude-proxy

# Or pass the key as a flag
npx opencode-go-claude-proxy --api-key sk-YOUR-KEY
```

---

### Method 2 — npm global install

```bash
npm install -g opencode-go-claude-proxy
```

Then start it:

```bash
# Pass the key directly
opencode-go-proxy --api-key sk-YOUR-KEY

# Or via environment variable (recommended — set it once in your shell profile)
export OPENCODE_API_KEY=sk-YOUR-KEY   # add to ~/.bashrc or ~/.zshrc
opencode-go-proxy
```

> **Why the difference from `npm run start`?**  
> After a global install you get the `opencode-go-proxy` command directly — this is the correct way to use it. `npm run start` is for contributors working on the source.

---

### Method 3 — Standalone binary (no Node.js needed)

Download the binary for your platform from the [Releases page](https://github.com/ahsanjamee/opencode-go-claude-proxy/releases):

| Platform | File |
|----------|------|
| Linux x64 | `opencode-go-proxy-linux-x64` |
| Linux arm64 | `opencode-go-proxy-linux-arm64` |
| macOS x64 | `opencode-go-proxy-macos-x64` |
| macOS arm64 | `opencode-go-proxy-macos-arm64` (Apple Silicon) |
| Windows x64 | `opencode-go-proxy-win-x64.exe` |

```bash
# macOS / Linux — make executable and run
chmod +x opencode-go-proxy-macos-arm64
./opencode-go-proxy-macos-arm64 --api-key sk-YOUR-KEY

# Windows — run in PowerShell or cmd
.\opencode-go-proxy-win-x64.exe --api-key sk-YOUR-KEY
```

---

### Method 4 — Docker

```bash
docker run -d \
  --name opencode-proxy \
  -p 3456:3456 \
  -e OPENCODE_API_KEY=sk-YOUR-KEY \
  ahsanjamee/opencode-go-claude-proxy:latest
```

> The `-d` flag runs it in the background. View logs with `docker logs opencode-proxy`.

**With docker-compose** (recommended for persistent setup):

```yaml
# docker-compose.yml
version: "3.9"
services:
  proxy:
    image: ahsanjamee/opencode-go-claude-proxy:latest
    ports:
      - "3456:3456"
    environment:
      OPENCODE_API_KEY: sk-YOUR-KEY
    restart: unless-stopped
```

```bash
docker compose up -d
```

---

### Method 5 — Source (for contributors)

```bash
git clone https://github.com/ahsanjamee/opencode-go-claude-proxy.git
cd opencode-go-claude-proxy
npm install
npm run dev -- --api-key sk-YOUR-KEY
```

> Notice the `--` separator: this tells npm to pass `--api-key` to the script, not treat it as an npm flag.

For the production build after making changes:

```bash
npm run build
# npm run start requires the -- separator to pass flags:
npm run start -- --api-key sk-YOUR-KEY
# Or just use the env var instead:
OPENCODE_API_KEY=sk-YOUR-KEY npm start
```

---

## Step 2 — Configure Claude Code to use the proxy

In the **same terminal** where you run `claude` (or add to your shell profile):

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:3456
export ANTHROPIC_AUTH_TOKEN=unused
export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1   # prevents 400 errors from beta headers
```

Then just run `claude` as normal. It will route through OpenCode Go automatically.

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

## Releasing a new version

```bash
# 1. Edit version in package.json
# 2. Commit, tag, push
git add .
git commit -m "chore: release v1.2.0"
git tag v1.2.0
git push origin main --tags
```

GitHub Actions automatically:
1. Builds binaries for 5 platforms
2. Pushes multi-arch Docker image to Docker Hub (`ahsanjamee/opencode-go-claude-proxy`) and GHCR
3. Publishes npm package
4. Creates GitHub Release with all binaries attached

Requires GitHub Secrets: `NPM_TOKEN`, `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`

---

## License

MIT
