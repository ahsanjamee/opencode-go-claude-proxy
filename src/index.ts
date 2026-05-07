import "dotenv/config";
import { createServer } from "./server.js";
import { serve } from "@hono/node-server";

function showHelp() {
  console.log(`
opencode-go-claude-proxy

Usage:
  opencode-go-proxy [options]

Options:
  --port <number>      Port to listen on (default: 3456 or $PROXY_PORT)
  --api-key <string>   OpenCode API key (or set OPENCODE_API_KEY env var)
  --base-url <url>     OpenCode base URL (default: https://opencode.ai/zen/go)
  --timeout <ms>       Request timeout in ms (default: 60000)
  --config <path>      Path to config file (or set PROXY_CONFIG_PATH env var)
  --help               Show this help message

Environment Variables:
  OPENCODE_API_KEY     Required. Your OpenCode Go API key.
  PROXY_CONFIG_PATH    Optional. Path to custom config JSON.
  PROXY_BASE_URL       Optional. Override the OpenCode base URL.
  PROXY_TIMEOUT_MS     Optional. Override the request timeout.
  PROXY_PORT           Optional. Port to listen on (overridden by --port).

Claude Code Setup:
  Edit ~/.claude/settings.json:
  {
    "env": {
      "ANTHROPIC_BASE_URL": "http://localhost:3456",
      "ANTHROPIC_AUTH_TOKEN": "unused",
      "ANTHROPIC_MODEL": "kimi-k2.5"
    },
    "theme": "dark-ansi",
    "effortLevel": "high"
  }
`);
}

function parseArgs(): { port: number; help: boolean } {
  const args = process.argv.slice(2);
  let port = parseInt(process.env.PROXY_PORT || process.env.PORT || "3456", 10);
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--api-key" && args[i + 1]) {
      process.env.OPENCODE_API_KEY = args[i + 1];
      i++;
    } else if (arg === "--base-url" && args[i + 1]) {
      process.env.PROXY_BASE_URL = args[i + 1];
      i++;
    } else if (arg === "--timeout" && args[i + 1]) {
      process.env.PROXY_TIMEOUT_MS = args[i + 1];
      i++;
    } else if (arg === "--config" && args[i + 1]) {
      process.env.PROXY_CONFIG_PATH = args[i + 1];
      i++;
    }
  }

  return { port, help };
}

async function main() {
  const { port, help } = parseArgs();

  if (help) {
    showHelp();
    process.exit(0);
  }

  if (!process.env.OPENCODE_API_KEY) {
    console.error(
      "Error: OPENCODE_API_KEY is required. Set it via --api-key or environment variable.",
    );
    showHelp();
    process.exit(1);
  }

  const app = createServer();

  console.log(`[server] opencode-go-claude-proxy starting on port ${port}`);
  console.log(
    `[server] baseUrl: ${process.env.PROXY_BASE_URL || "https://opencode.ai/zen/go"}`,
  );

  const server = serve({
    fetch: app.fetch,
    port,
  });

  console.log(`[server] Listening on http://localhost:${port}`);

  const shutdown = (signal: string) => {
    console.log(`\n[server] Received ${signal} — shutting down gracefully`);
    server.close(() => {
      console.log("[server] Closed");
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
