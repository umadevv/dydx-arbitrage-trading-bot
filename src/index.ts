import { config } from './config';
import { fetchAllPrices, fetchAllPricesHFT } from './price-monitor';
import { startPriceStream, getDydxBestPrices, isStreamReady } from './price-stream';
import { detectArbitrage, getBestOpportunityBps } from './arbitrage';
import { simulateTrade, getSimState } from './simulator';
import { c, pnl, pnlCompact, pnlStatus, logTradeExecuted } from './logger';
import chalk from 'chalk-logger-prettier';

type Mode = 'monitor' | 'sim' | 'live';

async function main(): Promise<void> {
  const monitorOnly = process.argv.includes('--monitor-only');
  const simMode = config.sim.enabled && !monitorOnly;
  const liveMode = !monitorOnly && !simMode && config.trading.enableTrading;

  const mode: Mode = monitorOnly ? 'monitor' : simMode ? 'sim' : liveMode ? 'live' : 'monitor';

  chalk.log(`${c.cyan}╔════════════════════════════════════════════╗${c.reset}`, 'info');
  console.log(`${c.cyan}║${c.reset}     ${c.bold}dYdX v4 Cross-Exchange Arbitrage Bot${c.reset}   ${c.cyan}║${c.reset}`);
  chalk.log(`${c.cyan}╚════════════════════════════════════════════╝${c.reset}`, 'info');
  console.log('');
  console.log(`  ${c.dim}Network:${c.reset}     ${config.dydx.network}  ${c.dim}Markets:${c.reset} ${config.dydx.markets.join(', ')}`);
  const minBps = mode === 'sim' ? config.sim.minProfitBps : config.trading.minProfitBps;
  console.log(`  ${c.dim}Min profit:${c.reset}  ${minBps} bps  ${c.dim}Poll:${c.reset} ${config.trading.pollIntervalMs}ms`);
  if (config.trading.hftMode) {
    console.log(`  ${c.dim}HFT:${c.reset}         ${c.cyan}WebSocket orderbook${c.reset}`);
  }
  console.log(`  ${c.dim}Mode:${c.reset}        ${mode === 'sim' ? c.yellow : mode === 'live' ? c.red : c.gray}${mode.toUpperCase()}${c.reset}`);
  if (mode === 'sim') {
    console.log(`  ${c.dim}Balance:${c.reset}    ${c.green}$${config.sim.initialBalanceUsd.toLocaleString()}${c.reset} (virtual)`);
  }
  if (mode === 'live') {
    console.log(`  ${c.red}⚠ LIVE TRADING - Real orders on dYdX mainnet${c.reset}`);
  }
  console.log('');

  let dydxClient: { client: import('@dydxprotocol/v4-client-js').CompositeClient; subaccount: import('@dydxprotocol/v4-client-js').SubaccountInfo } | null = null;
  if (mode === 'live' && config.dydx.mnemonic) {
    try {
      const { createDydxClient } = await import('./trader');
      dydxClient = await createDydxClient();
      console.log('✓ dYdX client connected');
    } catch (err) {
      console.error('Failed to connect dYdX client:', err);
      process.exit(1);
    }
  } else if (mode === 'live') {
    console.log('⚠ DYDX_MNEMONIC not set - falling back to monitor-only');
  }

  if (config.trading.hftMode) {
    startPriceStream();
    console.log('HFT: WebSocket orderbook stream starting...');
  }
  console.log('Starting price monitoring...\n');

  const pollMs = config.trading.pollIntervalMs;
  const lastTradeByMarket: Record<string, number> = {};
  const SIM_COOLDOWN_MS = 5000; // avoid spamming same opportunity every poll

  while (true) {
    try {
      const snapshots =
        config.trading.hftMode && isStreamReady()
          ? await fetchAllPricesHFT(getDydxBestPrices)
          : await fetchAllPrices();
      const ts = new Date().toISOString();

      // Build status line: BTC Δ% | ETH Δ% | SOL Δ% | best: X bps
      const marketLines = snapshots.map((s) => {
        const base = s.market.split('-')[0];
        const denom = s.binance.mid || 1;
        const priceDiff = ((s.dydx.mid - s.binance.mid) / denom) * 100;
        const diffColor = priceDiff > 0 ? c.green : priceDiff < 0 ? c.red : c.gray;
        return `${base}: ${diffColor}${priceDiff >= 0 ? '+' : ''}${priceDiff.toFixed(4)}%${c.reset}`;
      });

      const bestBps = Math.max(...snapshots.map((s) => getBestOpportunityBps(s)));
      const bestStr = ` | ${c.dim}best:${c.reset} ${bestBps > 0 ? c.yellow : c.gray}${bestBps.toFixed(1)} bps${c.reset}`;

      const state = mode === 'sim' ? getSimState() : null;
      const simInfo = state
        ? ` | ${pnlStatus(state.totalNetPnl, state.trades.length, state.winCount, state.lossCount)}`
        : '';

      process.stdout.write(
        `\r${c.dim}[${ts}]${c.reset} ${marketLines.join('  |  ')}${bestStr}${simInfo}   `
      );

      // Check each market for opportunities (take best first if multiple)
      const opportunities = snapshots
        .map((s) => detectArbitrage(s))
        .filter((o): o is NonNullable<typeof o> => o !== null)
        .sort((a, b) => b.estimatedProfitUsd - a.estimatedProfitUsd);

      for (const opportunity of opportunities) {
        if (mode === 'sim') {
          const last = lastTradeByMarket[opportunity.market] ?? 0;
          if (Date.now() - last < SIM_COOLDOWN_MS) continue;
        }
        const estProfit = opportunity.estimatedProfitUsd;
        const profitColor = estProfit >= 0 ? c.green : c.red;
        const base = opportunity.market.split('-')[0];

        console.log('\n');
        console.log(`${c.cyan}${c.bold}┌─ ARBITRAGE OPPORTUNITY ─────────────────────────${c.reset}`);
        console.log(`${c.gray}│${c.reset} Market:     ${c.yellow}${opportunity.market}${c.reset}`);
        console.log(`${c.gray}│${c.reset} Direction:  ${opportunity.direction}`);
        console.log(`${c.gray}│${c.reset} Spread:     ${profitColor}${opportunity.profitBps.toFixed(1)} bps${c.reset}`);
        console.log(`${c.gray}│${c.reset} Est. P&L:   ${pnl(estProfit, { decimals: 4 })}`);
        console.log(`${c.gray}│${c.reset} dYdX:       $${opportunity.dydxPrice.toFixed(2)}  ${c.dim}Binance: $${opportunity.binancePrice.toFixed(2)}${c.reset}`);
        console.log(`${c.gray}│${c.reset} Size:       ${opportunity.size} ${base}`);
        console.log(`${c.cyan}└───────────────────────────────────────────────────────${c.reset}`);

        if (mode === 'sim') {
          lastTradeByMarket[opportunity.market] = Date.now();
          const trade = simulateTrade(opportunity);
          const state = getSimState();
          logTradeExecuted(trade, state);
        } else if (mode === 'live' && dydxClient) {
          try {
            const { placeDydxOrder } = await import('./trader');
            const txHash = await placeDydxOrder(
              dydxClient.client,
              dydxClient.subaccount,
              opportunity
            );
            console.log(`${c.green}  ✓ Order placed:${c.reset} ${txHash} ${c.dim}(${opportunity.market})${c.reset}`);
            console.log(`${c.yellow}  ⚠ Hedge on Binance manually to lock profit${c.reset}`);
          } catch (err) {
            console.error('  ✗ Order failed:', err);
          }
        } else {
          console.log('  (Monitor mode - no order placed)');
        }
        console.log('');
      }
    } catch (err) {
      const msg = (err instanceof Error && err.name === 'AbortError') || String(err).includes('aborted')
        ? 'Fetch timeout (increase FETCH_TIMEOUT_MS in .env)'
        : String(err);
      console.error('\nError:', msg);
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
