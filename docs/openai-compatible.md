# Using Claude Code with an OpenAI-Compatible Provider

Claude Code supports OpenAI-compatible API providers in addition to the default
Anthropic API and the officially-supported third-party integrations (AWS Bedrock,
Google Vertex AI, Azure Foundry).

This lets you point the tool at any provider that speaks the OpenAI
`/chat/completions` API — for example:

- Local models via [Ollama](https://ollama.com)
- [LiteLLM proxy](https://docs.litellm.ai/docs/proxy/quick_start)
- Third-party gateways such as `api.chatanywhere.tech`
- Any other OpenAI-API-compatible endpoint

> **Note** — The default Claude Code workflow (authentication, billing, model
> selection, etc.) is built around Anthropic's API.  When you switch to an
> OpenAI-compatible provider, those first-party features are bypassed.

---

## Quick start

### 1. Set the environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | **Yes** (unless the endpoint has no auth) | API key sent as `Authorization: Bearer <key>` |
| `OPENAI_BASE_URL` | No (defaults to `https://api.openai.com/v1`) | Base URL of the provider |
| `OPENAI_API_BASE` | No | Alias for `OPENAI_BASE_URL` (either can be used) |
| `OPENAI_MODEL` | No (defaults to `gpt-4o-mini`) | Model to use — passed through to the provider unchanged |
| `API_PROVIDER` | No | Explicit override (see below) |

You can also use the existing `ANTHROPIC_MODEL` env var or the `--model` CLI
flag to specify the model; `OPENAI_MODEL` is just a convenience alias.

### 2. Run Claude Code

```bash
export OPENAI_API_KEY="sk-your-key"
export OPENAI_BASE_URL="https://api.chatanywhere.tech/v1"
# or: export OPENAI_API_BASE="https://api.chatanywhere.tech/v1"
export OPENAI_MODEL="gpt-4o-mini"

bun run dev
# or, once built:
node dist/cli.js
```

Claude Code automatically detects the `OPENAI_API_KEY` / `OPENAI_BASE_URL` /
`OPENAI_API_BASE` environment variables and switches to the OpenAI-compatible
provider.  No additional `API_PROVIDER` variable is needed.

### 3. Using a local Ollama server

```bash
export OPENAI_BASE_URL="http://localhost:11434/v1"
export OPENAI_API_KEY="ollama"   # Ollama ignores the key but the var must be set
export OPENAI_MODEL="llama3.2"

bun run dev
```

### 4. Using LiteLLM proxy (recommended for Anthropic models via proxy)

If your proxy supports Anthropic's API format you don't need any of the
OpenAI variables — just set:

```bash
export ANTHROPIC_BASE_URL="http://your-litellm-proxy:4000"
export ANTHROPIC_API_KEY="your-master-key"
```

LiteLLM and other proxies that speak *both* Anthropic and OpenAI formats work
this way without any special configuration.

---

## How it works

When either `OPENAI_API_KEY`, `OPENAI_BASE_URL`, or `OPENAI_API_BASE` is
present (and no higher-priority Bedrock / Vertex / Foundry flag is set),
Claude Code:

1. Sets the **provider** to `openai` internally.
2. Skips Anthropic-specific features: prompt caching, extended thinking, beta
   headers, OAuth, subscription checks.
3. Uses the built-in **OpenAI adapter** (`src/services/api/openai-adapter.ts`)
   which translates every `beta.messages.create()` call to the OpenAI
   `/chat/completions` endpoint.
4. Translates streaming SSE responses back to Anthropic's event format so the
   rest of the codebase sees no difference.
5. Bypasses the Claude model allowlist, so any model name is accepted.

---

## Environment variable reference

```bash
# Provider (choose one group)

# ── OpenAI-compatible ──────────────────────────────────────────────────────
OPENAI_API_KEY=sk-...          # API key
OPENAI_BASE_URL=https://...    # Base URL (default: https://api.openai.com/v1)
OPENAI_API_BASE=https://...    # Alias for OPENAI_BASE_URL (either can be used)
OPENAI_MODEL=gpt-4o-mini       # Model (default: gpt-4o-mini)

# ── Explicit override (takes precedence over everything else) ──────────────
API_PROVIDER=openai            # Force the openai provider even without OPENAI_API_KEY
#              bedrock | vertex | foundry | firstParty | anthropic

# ── Anthropic first-party ──────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://...  # Custom base URL (must speak Anthropic format)

# ── AWS Bedrock ────────────────────────────────────────────────────────────
CLAUDE_CODE_USE_BEDROCK=1

# ── Google Vertex AI ──────────────────────────────────────────────────────
CLAUDE_CODE_USE_VERTEX=1

# ── Azure Foundry ─────────────────────────────────────────────────────────
CLAUDE_CODE_USE_FOUNDRY=1
```

**Priority** (highest → lowest when multiple are set):
`API_PROVIDER` → `bedrock` → `vertex` → `foundry` → `openai` (auto-detected) → `firstParty`

---

## Troubleshooting

### I still see requests to `api.anthropic.com` in verbose output

This is expected.  At startup, Claude Code makes a handful of **non-model**
requests to Anthropic services (MCP server registry, background telemetry,
etc.) regardless of the configured provider.  These are **not** the model/chat
requests — they use different endpoints and do not carry your messages.

The important thing is that the model `POST` request goes to your
`OPENAI_BASE_URL` host (e.g. `https://api.chatanywhere.tech`).  Enable `BUN_CONFIG_VERBOSE_FETCH=1` and look for a POST
to your base URL host after you send a message.

### How do I confirm which provider is actually selected?

Set `DEBUG_PROVIDER=1` before running:

```bash
# bash / zsh
export DEBUG_PROVIDER=1
bun run dev

# PowerShell
$env:DEBUG_PROVIDER="1"
bun run dev
```

On the first API call you will see a line on stderr like:

```
[DEBUG_PROVIDER] resolved=openai reason=OPENAI_API_KEY, OPENAI_BASE_URL | API_PROVIDER=(unset) OPENAI_API_KEY=(set) OPENAI_BASE_URL=https://api.chatanywhere.tech/v1 ...
```

If `resolved=firstParty` is shown, the OpenAI env vars were not detected.
Check that they are exported in the **same shell** that runs `bun run dev`.

### Force a provider explicitly

You can bypass auto-detection with `API_PROVIDER`:

```bash
# Force OpenAI even without OPENAI_API_KEY / OPENAI_BASE_URL
export API_PROVIDER=openai

# Force first-party Anthropic even if OPENAI_API_KEY is set
export API_PROVIDER=firstParty
```

---

## Limitations

- **No streaming tool-call support for providers that do not follow the OpenAI
  streaming spec exactly** — the adapter expects standard SSE with
  `tool_calls[].function.arguments` deltas.
- **Extended thinking** (`thinking` budget) and **prompt caching** are Anthropic
  extensions; they are silently dropped when using an OpenAI-compatible provider.
- **Model validation** is skipped for OpenAI providers.  If you specify an
  unknown model the provider itself will return an error.
- **Authentication / billing** features that depend on Claude.ai OAuth are not
  available in this mode.
