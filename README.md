# dYdX v4 Arbitrage Bot

Cross-exchange arbitrage bot that monitors price differences between **dYdX v4** perpetuals and **Binance** spot, and optionally places orders on dYdX when profitable opportunities are detected.

## Strategy

- **buy_dydx_sell_binance**: When dYdX ask < Binance bid → buy on dYdX, sell on Binance
- **sell_dydx_buy_binance**: When dYdX bid > Binance ask → sell on dYdX, buy on Binance

The bot places **short-term IOC (Immediate-or-Cancel)** orders on dYdX for fast execution. You must **hedge on Binance manually** (or extend the bot with Binance API) to complete the arbitrage.

## Prerequisites

- Node.js 18+
- dYdX account with USDC deposited (for testnet: use [faucet](https://faucet.v4testnet.dydx.exchange))

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your mnemonic and settings
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DYDX_MNEMONIC` | 24-word secret phrase from dYdX | Required for trading |
| `DYDX_NETWORK` | `mainnet` or `testnet` | `testnet` |
| `DYDX_MARKETS` | Comma-separated markets (e.g. BTC-USD,ETH-USD,SOL-USD) | `BTC-USD,ETH-USD,SOL-USD` |
| `DYDX_SUBACCOUNT_NUMBER` | Subaccount index | `0` |
| `MIN_PROFIT_BPS` | Min profit in basis points to trigger | `10` |
| `MAX_POSITION_SIZE` | Max order size in base asset | `0.01` |
| `SLIPPAGE_BPS` | Slippage tolerance in bps | `50` |
| `ENABLE_TRADING` | Place real orders | `true` |
| `ENABLE_SIMULATION` | Simulate with real data (no real orders) | `false` |
| `SIM_INITIAL_BALANCE_USD` | Virtual starting balance for sim | `10000` |

## Usage

**Monitor only** (no orders, no simulation):

```bash
npm run monitor
```

**Simulation** (real data, virtual execution – no mnemonic needed):

```bash
# Set ENABLE_SIMULATION=true in .env
npm run dev
```

**Live trading** (real orders – requires mnemonic):

```bash
# Set ENABLE_SIMULATION=false, ENABLE_TRADING=true, DYDX_MNEMONIC in .env
npm run dev
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  dYdX Indexer   │     │  Binance API    │
│  (orderbook)    │     │  (orderbook)    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────▼──────┐
              │   Arbitrage │
              │   Detector  │
              └──────┬──────┘
                     │
         ┌───────────┴───────────┐
         │                       │
    ┌────▼────┐            ┌─────▼─────┐
    │ Monitor │            │  dYdX     │
    │  Only   │            │  Trader   │
    └─────────┘            └───────────┘
```

## Important Notes

1. **Testnet first**: Use `DYDX_NETWORK=testnet` and get test USDC from the faucet before mainnet.
2. **Hedging**: This bot only places orders on dYdX. You must hedge on Binance (or another CEX) to lock in profit.
3. **Fees**: Account for dYdX trading fees and Binance fees in `MIN_PROFIT_BPS`.
4. **Latency**: Cross-exchange arb is latency-sensitive; consider co-location for production.

## References

- [dYdX Integration Docs](https://docs.dydx.xyz/)
- [dYdX v4 Client (npm)](https://www.npmjs.com/package/@dydxprotocol/v4-client-js)
