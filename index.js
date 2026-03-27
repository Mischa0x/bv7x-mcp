#!/usr/bin/env node
/**
 * BV-7X MCP Server
 *
 * Model Context Protocol server exposing BV-7X oracle tools.
 * Runs as stdio transport (local) or SSE (remote).
 *
 * Usage:
 *   stdio:  node mcp-server.js
 *   SSE:    node mcp-server.js --sse --port 3100
 *   Claude: claude mcp add bv7x -- node /path/to/mcp-server.js
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { z } = require('zod');
const http = require('http');

// ── Config ──────────────────────────────────────────────────────────────
const BV7X_API = process.env.BV7X_API_URL || 'https://bv7x.ai';
const BV7X_TOKEN = process.env.BV7X_BEARER_TOKEN || ''; // Bearer token from /api/bv7x/oracle/verify
const MCP_SSE_API_KEY = process.env.MCP_SSE_API_KEY || ''; // Required for SSE mode auth
const API_TIMEOUT = 15000;

// ── HTTP helper ─────────────────────────────────────────────────────────
async function apiFetch(path, { auth = false } = {}) {
    const url = `${BV7X_API}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);
    const headers = { 'Accept': 'application/json', 'User-Agent': 'BV7X-MCP/1.0' };
    if (auth && BV7X_TOKEN) {
        headers['Authorization'] = `Bearer ${BV7X_TOKEN}`;
    }
    try {
        const res = await fetch(url, { signal: controller.signal, headers });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
        }
        return await res.json();
    } finally {
        clearTimeout(timeout);
    }
}

// ── MCP Server ──────────────────────────────────────────────────────────
const server = new McpServer({
    name: 'bv7x',
    version: '1.0.0',
    description: 'BV-7X Bitcoin Signal Oracle — autonomous BTC direction predictions with 60%+ verified accuracy, on-chain attestations, and daily skin-in-the-game Polymarket wagers.',
});

// ── Tool 1: get_btc_signal ──────────────────────────────────────────────
server.tool(
    'get_btc_signal',
    'Get BV-7X Bitcoin direction prediction. Returns signal direction (UP/DOWN/HOLD), confidence score, regime classification, and model version. Free tier returns direction and market context; full signal details require BV7X token holdings.',
    {
        horizon: z.enum(['2d', '3d', '7d']).optional().default('7d')
            .describe('Prediction horizon: 2d, 3d, or 7d (default: 7d)'),
    },
    async ({ horizon }) => {
        try {
            const [signalData, scorecard] = await Promise.all([
                apiFetch(`/api/bv7x/openclaw/signal?horizon=${horizon}`),
                apiFetch('/api/bv7x/scorecard').catch(() => null),
            ]);

            const accuracy = scorecard?.summary?.dedupedAccuracy || scorecard?.summary?.accuracy || null;
            const totalPredictions = scorecard?.summary?.dedupedTotal || scorecard?.summary?.totalPredictions || null;

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        signal: signalData.signal || 'GATED',
                        confidence: signalData.confidence || null,
                        horizon,
                        regime: signalData.regime || null,
                        model_version: signalData.model_version || signalData.modelVersion || null,
                        timestamp: signalData.timestamp || new Date().toISOString(),
                        market_context: {
                            btc_price: signalData.btcPrice || signalData.btc_price || null,
                            fear_greed: signalData.fearGreed || signalData.fear_greed || null,
                            etf_flow_7d: signalData.etfFlow7d || signalData.etf_flow_7d || null,
                        },
                        track_record: accuracy ? {
                            accuracy_pct: accuracy,
                            total_predictions: totalPredictions,
                            source: 'live',
                        } : null,
                        note: signalData.signal === 'GATED'
                            ? 'Direction is gated. Hold 500M+ BV7X for full signal access, or purchase via Commerce API.'
                            : undefined,
                        access: {
                            free: 'Market context + track record (this response)',
                            basic: '500M BV7X → full signal direction + confidence',
                            premium: '1B BV7X → full breakdown + parsimonious model',
                            commerce: 'POST /api/bv7x/commerce/purchase → pay-per-call with USDC',
                        },
                    }, null, 2),
                }],
            };
        } catch (err) {
            console.error('[MCP] get_btc_signal error:', err.message);
            return { content: [{ type: 'text', text: 'Error fetching signal. The API may be temporarily unavailable.' }], isError: true };
        }
    }
);

// ── Tool 2: get_signal_with_proof ───────────────────────────────────────
server.tool(
    'get_signal_with_proof',
    'Get BV-7X signal bundled with on-chain proof: EAS attestation UID, Polymarket bet transaction hash, and IPFS metadata CID. Enables trustless verification of predictions. Commerce purchase required ($0.50 USDC).',
    {
        horizon: z.enum(['2d', '3d', '7d']).optional().default('7d')
            .describe('Prediction horizon: 2d, 3d, or 7d (default: 7d)'),
    },
    async ({ horizon }) => {
        try {
            const [latest, scorecard] = await Promise.all([
                apiFetch('/api/bv7x/onchain-oracle/latest'),
                apiFetch('/api/bv7x/scorecard').catch(() => null),
            ]);

            const pred = latest?.data;
            if (!pred) {
                return { content: [{ type: 'text', text: 'No attestation data available yet.' }] };
            }

            const accuracy = scorecard?.summary?.dedupedAccuracy || null;

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        prediction: {
                            date: pred.date,
                            direction: pred.direction,
                            confidence: pred.confidence,
                            btc_price: pred.btcPrice,
                            horizon: pred.horizon || '7d',
                            target_date: pred.targetDate,
                        },
                        on_chain_proof: {
                            attestation_uid: pred.uid,
                            resolution_uid: pred.resolutionUID || null,
                            tx_hash: pred.txHash,
                            ipfs_cid: pred.cid,
                            chain: 'Base (8453)',
                            eas_contract: '0x4200000000000000000000000000000000000021',
                        },
                        resolution: pred.resolved ? {
                            correct: pred.correct,
                            resolution_price: pred.resolutionPrice,
                            return_bps: pred.returnBps,
                        } : { status: 'pending', resolves: pred.targetDate },
                        verification: {
                            verify_url: `https://base.easscan.org/attestation/view/${pred.uid}`,
                            ipfs_url: pred.cid ? `https://gateway.pinata.cloud/ipfs/${pred.cid}` : null,
                            api_verify: `https://bv7x.ai/api/bv7x/onchain-oracle/verify/${pred.uid}`,
                        },
                        track_record_accuracy: accuracy ? `${accuracy}%` : null,
                        purchase: {
                            note: 'Full signal-with-proof bundle available via Commerce API for $0.50 USDC',
                            endpoint: 'POST https://bv7x.ai/api/bv7x/commerce/purchase',
                            offering: 'bv7x_signal_with_proof',
                        },
                    }, null, 2),
                }],
            };
        } catch (err) {
            console.error('[MCP] Tool error:', err.message);
            return { content: [{ type: 'text', text: 'Error: The API may be temporarily unavailable.' }], isError: true };
        }
    }
);

// ── Tool 3: get_track_record ────────────────────────────────────────────
server.tool(
    'get_track_record',
    'Get BV-7X verified prediction track record. Returns accuracy statistics, recent predictions with outcomes, and on-chain attestation UIDs for trustless verification. Free and public.',
    {
        days: z.number().int().min(7).max(90).optional().default(30)
            .describe('Number of days of history to return (default: 30, max: 90)'),
    },
    async ({ days }) => {
        try {
            const [scorecard, oracleStats, oracleHistory] = await Promise.all([
                apiFetch(`/api/bv7x/scorecard?horizon=7`),
                apiFetch('/api/bv7x/onchain-oracle/stats').catch(() => null),
                apiFetch(`/api/bv7x/onchain-oracle/history?limit=${days}`).catch(() => null),
            ]);

            const summary = scorecard?.summary || {};
            const predictions = (scorecard?.predictions || []).slice(0, days);

            // Build attestation lookup from oracle history
            const uidMap = {};
            if (oracleHistory?.data) {
                for (const entry of oracleHistory.data) {
                    if (entry.date && entry.uid) uidMap[entry.date] = entry.uid;
                }
            }

            // Enrich predictions with UIDs
            const enriched = predictions.map(p => ({
                date: p.date,
                direction: p.direction,
                confidence: p.confidence,
                btc_price: p.btcPrice,
                outcome: p.outcome ? {
                    correct: p.outcome.correct,
                    actual_direction: p.outcome.actualDirection,
                    return_pct: p.outcome.actualReturn,
                } : null,
                status: p.status,
                attestation_uid: uidMap[p.date] || null,
            }));

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        summary: {
                            total_predictions: summary.dedupedTotal || summary.totalPredictions,
                            wins: summary.dedupedWins || summary.wins,
                            losses: (summary.dedupedTotal || summary.totalPredictions) - (summary.dedupedWins || summary.wins) - (summary.holds || 0),
                            accuracy_pct: summary.dedupedAccuracy || summary.accuracy,
                            holds: summary.holds || 0,
                            streak: summary.streak || null,
                            first_prediction: summary.firstPrediction,
                            last_prediction: summary.lastPrediction,
                        },
                        on_chain_stats: oracleStats?.data || null,
                        predictions: enriched,
                        verification: {
                            scorecard_url: 'https://bv7x.ai/terminal#verify',
                            eas_explorer: 'https://base.easscan.org',
                            api_verify: 'https://bv7x.ai/api/bv7x/onchain-oracle/verify/{uid}',
                        },
                    }, null, 2),
                }],
            };
        } catch (err) {
            console.error('[MCP] Tool error:', err.message);
            return { content: [{ type: 'text', text: 'Error: The API may be temporarily unavailable.' }], isError: true };
        }
    }
);

// ── Tool 4: get_crowd_vs_oracle ─────────────────────────────────────────
server.tool(
    'get_crowd_vs_oracle',
    'Compare BV-7X oracle accuracy against Polymarket crowd predictions on 7-day BTC direction. Shows head-to-head matchup, historical accuracy, and current agreement/disagreement.',
    {},
    async () => {
        try {
            const scorecard = await apiFetch('/api/bv7x/scorecard?horizon=7');
            const cvo = scorecard?.summary?.cvoOracle || null;

            if (!cvo) {
                return { content: [{ type: 'text', text: 'Crowd-vs-oracle data not yet available.' }] };
            }

            // Find latest prediction with poly data
            const latest = (scorecard.predictions || []).find(p => p.poly);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        comparison: {
                            oracle_accuracy: `${cvo.accuracy}%`,
                            oracle_correct: cvo.correct,
                            oracle_total: cvo.total,
                            crowd_source: 'Polymarket',
                        },
                        current_matchup: latest ? {
                            date: latest.date,
                            oracle_direction: latest.direction,
                            crowd_probability: latest.poly?.crowdProb,
                            strike_price: latest.poly?.strike,
                            target_date: latest.poly?.targetDate,
                        } : null,
                        context: {
                            description: 'BV-7X bets real money on Polymarket against the crowd on every prediction. This comparison tracks which source is more accurate over time.',
                            polymarket_url: 'https://polymarket.com',
                            oracle_wager_page: 'https://bv7x.ai/wager',
                        },
                    }, null, 2),
                }],
            };
        } catch (err) {
            console.error('[MCP] Tool error:', err.message);
            return { content: [{ type: 'text', text: 'Error: The API may be temporarily unavailable.' }], isError: true };
        }
    }
);

// ── Tool 5: get_market_context ──────────────────────────────────────────
server.tool(
    'get_market_context',
    'Get current Bitcoin market context: BTC price, Fear & Greed Index, ETF flows, derivatives data, and regime classification. Free and public.',
    {},
    async () => {
        try {
            const [btcPrice, fearGreed, etfFlows, derivatives] = await Promise.all([
                apiFetch('/api/btc-price').catch(() => null),
                apiFetch('/api/fear-greed').catch(() => null),
                apiFetch('/api/etf-flows').catch(() => null),
                apiFetch('/api/derivatives-summary').catch(() => null),
            ]);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        btc_price: {
                            price: btcPrice?.price || btcPrice?.data?.price || null,
                            change_24h: btcPrice?.change24h || btcPrice?.data?.change24h || null,
                        },
                        fear_greed: {
                            value: fearGreed?.value || fearGreed?.data?.value || null,
                            classification: fearGreed?.classification || fearGreed?.data?.classification || null,
                        },
                        etf_flows: {
                            flow_7d: etfFlows?.flow7d || etfFlows?.data?.flow7d || null,
                            flow_30d: etfFlows?.flow30d || etfFlows?.data?.flow30d || null,
                        },
                        derivatives: derivatives?.data ? {
                            funding_rate: derivatives.data.fundingRate || null,
                            open_interest: derivatives.data.openInterest || null,
                            dvol: derivatives.data.dvol || null,
                        } : null,
                        timestamp: new Date().toISOString(),
                    }, null, 2),
                }],
            };
        } catch (err) {
            console.error('[MCP] Tool error:', err.message);
            return { content: [{ type: 'text', text: 'Error: The API may be temporarily unavailable.' }], isError: true };
        }
    }
);

// ── Tool 6: verify_attestation ──────────────────────────────────────────
server.tool(
    'verify_attestation',
    'Verify a BV-7X prediction attestation on-chain via its EAS UID. Returns decoded attestation data from Base chain, confirming the prediction was committed before the outcome was known.',
    {
        uid: z.string().regex(/^0x[a-fA-F0-9]{64}$/)
            .describe('EAS attestation UID (0x-prefixed, 64 hex chars)'),
    },
    async ({ uid }) => {
        try {
            const result = await apiFetch(`/api/bv7x/onchain-oracle/verify/${uid}`);

            if (!result?.success || !result?.data) {
                return { content: [{ type: 'text', text: `Attestation ${uid} not found on-chain.` }] };
            }

            const att = result.data;
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        uid: att.uid,
                        attester: att.attester,
                        schema: att.schema,
                        schema_version: att.schemaVersion,
                        decoded_data: att.decoded,
                        verification: {
                            chain: 'Base (8453)',
                            eas_contract: '0x4200000000000000000000000000000000000021',
                            explorer_url: `https://base.easscan.org/attestation/view/${uid}`,
                        },
                    }, null, 2),
                }],
            };
        } catch (err) {
            console.error('[MCP] verify_attestation error:', err.message);
            return { content: [{ type: 'text', text: 'Error verifying attestation. The API may be temporarily unavailable.' }], isError: true };
        }
    }
);

// ── Tool 7: get_agent_identity ──────────────────────────────────────────
server.tool(
    'get_agent_identity',
    'Get BV-7X ERC-8004 on-chain agent identity: agent ID, reputation score, registration details, and available services. Proves BV-7X is a registered trustless agent on Base.',
    {},
    async () => {
        try {
            const [identity, reputation] = await Promise.all([
                apiFetch('/api/bv7x/agent/identity'),
                apiFetch('/api/bv7x/agent/reputation').catch(() => null),
            ]);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        agent_id: identity.agentId,
                        chain: identity.chain,
                        registered: identity.registered,
                        wallet: identity.wallet,
                        identity_registry: identity.identityRegistry,
                        reputation_registry: identity.reputationRegistry,
                        reputation: reputation ? {
                            total_feedback: reputation.reputation?.totalFeedback,
                            average_score: reputation.reputation?.averageScore,
                        } : null,
                        services: identity.agentCard?.services || [],
                        verification: {
                            identity_registry_url: `https://basescan.org/address/${identity.identityRegistry}`,
                            agent_card: 'https://bv7x.ai/.well-known/agent-card.json',
                        },
                    }, null, 2),
                }],
            };
        } catch (err) {
            console.error('[MCP] Tool error:', err.message);
            return { content: [{ type: 'text', text: 'Error: The API may be temporarily unavailable.' }], isError: true };
        }
    }
);

// ── Tool 8: get_regime ───────────────────────────────────────────────────
server.tool(
    'get_regime',
    'Get current BTC market regime classification. Returns one of 7 regimes (CRISIS/BEAR_TREND/BEAR_RECOVERY/CHOP/BULL_TREND/EUPHORIA/DEFAULT) with risk level, thresholds, and classification inputs. Unique data product for risk-adjusting agent strategies.',
    {},
    async () => {
        try {
            const regime = await apiFetch('/api/bv7x/regime', { auth: true });
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        regime: regime.regime,
                        risk_level: regime.risk_level,
                        description: regime.description,
                        thresholds_applied: regime.thresholds_applied,
                        classification_inputs: regime.classification_inputs,
                        model_version: regime.model_version,
                        all_regimes: regime.all_regimes,
                        timestamp: regime.timestamp,
                    }, null, 2),
                }],
            };
        } catch (err) {
            console.error('[MCP] Tool error:', err.message);
            return { content: [{ type: 'text', text: 'Error: The API may be temporarily unavailable.' }], isError: true };
        }
    }
);

// ── Tool 9: get_copy_trade_status ────────────────────────────────────────
server.tool(
    'get_copy_trade_status',
    'Get copy-trade service status. Returns push channel details (WebSocket URL, webhook registration), signal timing, supported horizons, and connected client count. Use this to set up real-time trade replication.',
    {},
    async () => {
        try {
            const status = await apiFetch('/api/bv7x/copy-trade/status');
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(status, null, 2),
                }],
            };
        } catch (err) {
            console.error('[MCP] Tool error:', err.message);
            return { content: [{ type: 'text', text: 'Error: The API may be temporarily unavailable.' }], isError: true };
        }
    }
);

// ── Resource: Agent Card ────────────────────────────────────────────────
server.resource(
    'agent-card',
    'bv7x://agent-card',
    { description: 'BV-7X agent card — ERC-8004 metadata, services, and commerce offerings', mimeType: 'application/json' },
    async () => {
        const card = await apiFetch('/.well-known/agent-card.json');
        return { contents: [{ uri: 'bv7x://agent-card', text: JSON.stringify(card, null, 2), mimeType: 'application/json' }] };
    }
);

// ── Resource: OpenAPI Spec ──────────────────────────────────────────────
server.resource(
    'openapi-spec',
    'bv7x://openapi',
    { description: 'BV-7X OpenAPI 3.1 specification for agent integration', mimeType: 'application/json' },
    async () => {
        const spec = await apiFetch('/.well-known/openapi.json');
        return { contents: [{ uri: 'bv7x://openapi', text: JSON.stringify(spec, null, 2), mimeType: 'application/json' }] };
    }
);

// ── Transport ───────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    const isSSE = args.includes('--sse');
    const portIdx = args.indexOf('--port');
    const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 3100;

    if (isSSE) {
        // SSE transport for remote access
        const transports = {};
        const allowedOrigin = process.env.MCP_SSE_CORS_ORIGIN || `http://localhost:${port}`;
        const httpServer = http.createServer(async (req, res) => {
            const url = new URL(req.url, `http://localhost:${port}`);

            // CORS headers — restricted to configured origin (default: localhost only)
            res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            // API key auth for SSE mode (skip /health for monitoring)
            if (url.pathname !== '/health' && MCP_SSE_API_KEY) {
                const authHeader = req.headers.authorization;
                if (!authHeader || authHeader !== `Bearer ${MCP_SSE_API_KEY}`) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid or missing API key. Set Authorization: Bearer <MCP_SSE_API_KEY>' }));
                    return;
                }
            }

            if (url.pathname === '/sse') {
                const transport = new SSEServerTransport('/messages', res);
                transports[transport.sessionId] = transport;
                res.on('close', () => delete transports[transport.sessionId]);
                await server.connect(transport);
            } else if (url.pathname === '/messages') {
                const sessionId = url.searchParams.get('sessionId');
                const transport = transports[sessionId];
                if (!transport) {
                    res.writeHead(404);
                    res.end('Session not found');
                    return;
                }
                await transport.handlePostMessage(req, res);
            } else if (url.pathname === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', server: 'bv7x-mcp', version: '1.0.0' }));
            } else {
                res.writeHead(404);
                res.end('Not found');
            }
        });

        httpServer.listen(port, () => {
            console.error(`BV-7X MCP server (SSE) listening on port ${port}`);
            console.error(`Connect: http://localhost:${port}/sse`);
        });
    } else {
        // stdio transport for local use (Claude Code, LangChain, etc.)
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('BV-7X MCP server running on stdio');
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
