# BV-7X MCP Server

Bitcoin prediction oracle for AI agents via [Model Context Protocol](https://modelcontextprotocol.io).

BV-7X is an autonomous BTC direction oracle that predicts whether Bitcoin will be higher or lower in 7 days. It bets real USDC on every prediction via Polymarket and attests all outcomes on-chain via EAS (Ethereum Attestation Service) on Base.

## Quick Start

### Claude Code

```bash
claude mcp add bv7x -- npx @bv7x/mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bv7x": {
      "command": "npx",
      "args": ["@bv7x/mcp"]
    }
  }
}
```

### Standalone

```bash
npx @bv7x/mcp
```

### With API Key (premium signal access)

```bash
BV7X_API_KEY=your_key npx @bv7x/mcp
```

### SSE Mode (remote access)

```bash
npx @bv7x/mcp -- --sse --port 3100
```

## Available Tools

| Tool | Description | Auth |
|------|-------------|------|
| `get_btc_signal` | BTC direction prediction (UP/DOWN/HOLD) with confidence, regime, model version | Free (direction gated) / Premium |
| `get_market_context` | BTC price, Fear & Greed, ETF flows, derivatives, regime | Free |
| `get_track_record` | Verified prediction history with accuracy stats and on-chain attestation UIDs | Free |
| `get_crowd_vs_oracle` | BV-7X oracle vs Polymarket crowd accuracy comparison | Free |
| `get_regime` | Market regime classification (7 types: CRISIS to EUPHORIA) | Premium |
| `get_signal_with_proof` | Signal + EAS attestation UID + Polymarket tx hash + IPFS CID | $0.50 USDC |
| `verify_attestation` | Verify any prediction on-chain via EAS UID | Free |
| `get_agent_identity` | ERC-8004 on-chain agent identity and reputation | Free |
| `get_copy_trade_status` | Copy-trade WebSocket/webhook setup info | Free |

## Resources

| Resource | URI | Description |
|----------|-----|-------------|
| Agent Card | `bv7x://agent-card` | ERC-8004 metadata, services, and commerce offerings |
| OpenAPI Spec | `bv7x://openapi` | OpenAPI 3.1 specification for REST integration |

## Access Tiers

| Tier | Requirement | Access |
|------|-------------|--------|
| Free | None | Market context, track record, crowd comparison, attestation verification |
| Basic | 500M BV7X tokens | Full signal direction + confidence |
| Premium | 1B BV7X tokens | Full model breakdown + 30-day history |
| Commerce | USDC (pay-per-call) | Signal-with-proof bundle ($0.50) |

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `BV7X_API_URL` | `https://bv7x.ai` | API base URL |
| `BV7X_BEARER_TOKEN` | (empty) | Bearer token for premium endpoints |
| `MCP_SSE_API_KEY` | (empty) | API key for SSE mode authentication |
| `MCP_SSE_CORS_ORIGIN` | `http://localhost:3100` | Allowed CORS origin for SSE |

## How It Works

BV-7X generates a new BTC prediction every day at 21:35 UTC using a 4-signal voting model validated across 18 walk-forward folds (63%+ OOS accuracy). Every prediction is:

1. Computed autonomously (no human intervention)
2. Bet on Polymarket with real USDC (skin in the game)
3. Attested on-chain via EAS on Base (tamper-proof timestamps)
4. Resolved after 7 days with on-chain outcome attestation

The MCP server gives your AI agent direct access to this intelligence pipeline.

## Links

- [bv7x.ai](https://bv7x.ai) — Live terminal
- [Performance](https://bv7x.ai/performance) — Wager track record
- [Agent Card](https://bv7x.ai/.well-known/agent-card.json) — ERC-8004 metadata
- [OpenAPI Spec](https://bv7x.ai/.well-known/openapi.json) — REST API docs
- [EAS Explorer](https://base.easscan.org) — On-chain attestation verification

## License

MIT
