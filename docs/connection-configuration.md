# Connection configuration

TradeBot separates four concerns that the older LLM-TradeBot project mixed together:

1. provider metadata: provider, protocol, base URL, and model ID;
2. secrets: API keys and exchange secrets stored outside the browser;
3. Agent authorization: which Agents may call a configured model;
4. execution capability: Paper, signed read-only account access, or exchange writes.

## Reference project findings

LLM-TradeBot exposed eight fixed providers through `.env`, YAML, and Dashboard settings: DeepSeek, OpenAI, Claude, Qwen, Gemini, Kimi, MiniMax, and GLM. It also used JSON account files for multiple Binance accounts.

That structure is useful as an inventory, but it should not be copied directly:

- several model IDs in the old README are retired or legacy;
- a static provider dropdown becomes stale quickly;
- browser-managed API keys are difficult to secure and rotate;
- a generic "connected" status hides the difference between account reads and order writes;
- account configuration must never imply that a Runtime has a live execution adapter.

The new Web configuration surface therefore uses editable model IDs and protocol-aware provider profiles. Production should discover models from each provider's server-side Models API where one exists.

## Current TypeScript Runtime support

| Connection | Current capability | Secret source |
| --- | --- | --- |
| DeepSeek | Structured Bull, Bear, and Reflection calls with rule fallback | `DEEPSEEK_*` environment variables |
| OpenAI | Web configuration contract only; Runtime adapter required | Future server vault |
| Anthropic | Web configuration contract only; dedicated Messages API adapter required | Future server vault |
| Google Gemini | Web configuration contract only; Runtime adapter required | Future server vault |
| OpenRouter | Web configuration contract only; OpenAI-compatible adapter required | Future server vault |
| Ollama | Web configuration contract only; local adapter and network policy required | No API key by default |
| Custom OpenAI-compatible | Web configuration contract only; endpoint allowlist and adapter required | Future server vault |
| Binance public market data | Available without credentials | None |
| Binance signed account reads | Read-only reconciliation | `BINANCE_API_KEY`, `BINANCE_API_SECRET` |
| Binance exchange writes | Not implemented and locked in the Web UI | Not accepted |

The Web forms are an interactive mock until a backend configuration API exists. They deliberately keep only non-secret metadata in memory and clear Secret fields on every render.

## Model freshness

The defaults shown in the Web UI were checked on 2026-07-26:

- DeepSeek: `deepseek-v4-flash`
- OpenAI: `gpt-5.2`
- Anthropic: `claude-sonnet-5`
- Google Gemini: `gemini-3.6-flash`
- Ollama example: `gemma3`

These are editable examples, not an eternal allowlist. Production should validate a model against the selected provider before a Candidate Strategy Profile can reference it.

Official references:

- DeepSeek API change log: <https://api-docs.deepseek.com/updates/>
- OpenAI Models API: <https://platform.openai.com/docs/api-reference/models>
- Anthropic model overview: <https://platform.claude.com/docs/en/about-claude/models/overview>
- Gemini Models API: <https://ai.google.dev/api/models>
- OpenRouter Models API: <https://openrouter.ai/docs/api/api-reference/models/get-models>
- Ollama list models: <https://docs.ollama.com/api/tags>
- Binance USD-M Futures account API: <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account>

## Production backend contract

A future backend should expose metadata and write-only Secret operations separately:

```text
GET    /api/config/capabilities
GET    /api/config/llm-connections
PUT    /api/config/llm-connections/:id
POST   /api/config/llm-connections/:id/test
POST   /api/config/llm-connections/:id/rotate-secret

GET    /api/config/exchange-connections
PUT    /api/config/exchange-connections/:id
POST   /api/config/exchange-connections/:id/test-read
POST   /api/config/exchange-connections/:id/rotate-secret
```

Responses must never return raw secrets. At most, they may return `configured`, `rotatedAt`, `lastValidatedAt`, and a non-sensitive key fingerprint.

## Live-account requirements

Adding a live account form is not enough to enable real trading. Live execution must remain locked until all of the following exist:

- a reviewed exchange-write adapter with idempotent client order IDs;
- symbol precision, quantity, margin, retry, and cancellation handling;
- API keys with withdrawal permission disabled and IP restrictions enabled;
- an encrypted Secret vault with rotation and revocation;
- role-based access control and operator re-authentication;
- immutable audit events for credential, permission, and mode changes;
- explicit capital, drawdown, position, and execution-rate limits;
- a separate human approval to leave Paper mode.

No Copilot message, Human Market Thesis, or Strategy Change Proposal may grant exchange-write capability.
