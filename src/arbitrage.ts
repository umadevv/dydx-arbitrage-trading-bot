import type { PriceSnapshot } from './price-monitor';
import { config } from './config';

export type ArbitrageDirection = 'buy_dydx_sell_binance' | 'sell_dydx_buy_binance' | null;

export interface ArbitrageOpportunity {
  market: string;
  direction: ArbitrageDirection;
  profitBps: number;
  dydxPrice: number;
  binancePrice: number;
  size: number;
  estimatedProfitUsd: number;
}

/** Best opportunity in bps (for display). Negative = no cross. */
export function getBestOpportunityBps(snapshot: PriceSnapshot): number {
  const { dydx, binance } = snapshot;
  const buyBps = ((binance.bid - dydx.bestAsk) / dydx.bestAsk) * 10_000;
  const sellBps = ((dydx.bestBid - binance.ask) / binance.ask) * 10_000;
  return Math.max(buyBps, sellBps);
}

/**
 * Detect arbitrage opportunity between dYdX and Binance
 *
 * Strategy:
 * - buy_dydx_sell_binance: dYdX ask < Binance bid → buy on dYdX, sell on Binance
 * - sell_dydx_buy_binance: dYdX bid > Binance ask → sell on dYdX, buy on Binance
 */
export function detectArbitrage(snapshot: PriceSnapshot): ArbitrageOpportunity | null {
  const { market, dydx, binance } = snapshot;
  const minProfitBps = config.sim.enabled
    ? config.sim.minProfitBps
    : config.trading.minProfitBps;
  const size = config.trading.maxPositionSize;

  // Opportunity 1: Buy on dYdX (pay ask), sell on Binance (receive bid)
  const buyDydxSellBinanceProfitBps =
    ((binance.bid - dydx.bestAsk) / dydx.bestAsk) * 10_000;
  if (buyDydxSellBinanceProfitBps >= minProfitBps) {
    const estimatedProfitUsd = size * (binance.bid - dydx.bestAsk);
    return {
      market,
      direction: 'buy_dydx_sell_binance',
      profitBps: buyDydxSellBinanceProfitBps,
      dydxPrice: dydx.bestAsk,
      binancePrice: binance.bid,
      size,
      estimatedProfitUsd,
    };
  }

  // Opportunity 2: Sell on dYdX (receive bid), buy on Binance (pay ask)
  const sellDydxBuyBinanceProfitBps =
    ((dydx.bestBid - binance.ask) / binance.ask) * 10_000;
  if (sellDydxBuyBinanceProfitBps >= minProfitBps) {
    const estimatedProfitUsd = size * (dydx.bestBid - binance.ask);
    return {
      market,
      direction: 'sell_dydx_buy_binance',
      profitBps: sellDydxBuyBinanceProfitBps,
      dydxPrice: dydx.bestBid,
      binancePrice: binance.ask,
      size,
      estimatedProfitUsd,
    };
  }

  return null;
}
