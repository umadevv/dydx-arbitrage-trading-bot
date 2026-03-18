import dotenv from 'dotenv';
dotenv.config();

export const config = {
  dydx: {
    mnemonic: process.env.DYDX_MNEMONIC ?? '',
    network: (process.env.DYDX_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet',
    markets: (process.env.DYDX_MARKETS ?? 'BTC-USD,ETH-USD,SOL-USD').split(',').map((m) => m.trim()).filter(Boolean),
    subaccountNumber: parseInt(process.env.DYDX_SUBACCOUNT_NUMBER ?? '0', 10),
  },
  trading: {
    minProfitBps: parseInt(process.env.MIN_PROFIT_BPS ?? '10', 10),
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE ?? '0.01'),
    slippageBps: parseInt(process.env.SLIPPAGE_BPS ?? '50', 10),
    enableTrading: process.env.ENABLE_TRADING !== 'false',
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '300', 10),
    fetchTimeoutMs: parseInt(process.env.FETCH_TIMEOUT_MS ?? '15000', 10),
    hftMode: process.env.HFT_MODE === 'true',
  },
  sim: {
    enabled: process.env.ENABLE_SIMULATION === 'true',
    initialBalanceUsd: parseFloat(process.env.SIM_INITIAL_BALANCE_USD ?? '10000'),
    /** Lower threshold in sim so you can see trades (real arb is rare). Live should use 15+ bps. */
    minProfitBps: parseInt(process.env.SIM_MIN_PROFIT_BPS ?? '1', 10),
  },
  endpoints: {
    indexerMainnet: 'https://indexer.dydx.trade',
    indexerTestnet: 'https://indexer.v4testnet.dydx.exchange',
    binance: 'https://api.binance.com',
  },
} as const;

export function getIndexerUrl(): string {
  return config.dydx.network === 'mainnet'
    ? config.endpoints.indexerMainnet
    : config.endpoints.indexerTestnet;
}

export function getWebSocketUrl(): string {
  const base = getIndexerUrl();
  return base.replace(/^https?:\/\//, 'wss://') + '/v4/ws';
}
