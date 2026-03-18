import { config } from './config';
import type { ArbitrageOpportunity } from './arbitrage';

// dYdX maker ~0.02%, taker ~0.05%; Binance ~0.1%
const DYDX_FEE_BPS = 5;
const BINANCE_FEE_BPS = 10;

export interface SimTrade {
  id: number;
  market: string;
  timestamp: string;
  direction: string;
  size: number;
  dydxPrice: number;
  binancePrice: number;
  grossProfitUsd: number;
  feesUsd: number;
  netProfitUsd: number;
}

export interface SimState {
  virtualBalanceUsd: number;
  trades: SimTrade[];
  totalNetPnl: number;
  winCount: number;
  lossCount: number;
}

let simState: SimState = {
  virtualBalanceUsd: config.sim.initialBalanceUsd,
  trades: [],
  totalNetPnl: 0,
  winCount: 0,
  lossCount: 0,
};

/**
 * Simulate executing an arbitrage trade using real market data.
 * Deducts fees and updates virtual balance.
 */
export function simulateTrade(opportunity: ArbitrageOpportunity): SimTrade {
  const { direction, size, dydxPrice, binancePrice, estimatedProfitUsd } = opportunity;

  const dydxNotional = size * dydxPrice;
  const binanceNotional = size * binancePrice;

  const dydxFee = (dydxNotional * DYDX_FEE_BPS) / 10_000;
  const binanceFee = (binanceNotional * BINANCE_FEE_BPS) / 10_000;
  const feesUsd = dydxFee + binanceFee;

  const netProfitUsd = estimatedProfitUsd - feesUsd;

  const trade: SimTrade = {
    id: simState.trades.length + 1,
    market: opportunity.market,
    timestamp: new Date().toISOString(),
    direction: direction ?? 'unknown',
    size,
    dydxPrice,
    binancePrice,
    grossProfitUsd: estimatedProfitUsd,
    feesUsd,
    netProfitUsd,
  };

  simState.trades.push(trade);
  simState.virtualBalanceUsd += netProfitUsd;
  simState.totalNetPnl += netProfitUsd;

  if (netProfitUsd > 0) simState.winCount++;
  else simState.lossCount++;

  return trade;
}

export function getSimState(): SimState {
  return { ...simState };
}

export function resetSimulator(): void {
  simState = {
    virtualBalanceUsd: config.sim.initialBalanceUsd,
    trades: [],
    totalNetPnl: 0,
    winCount: 0,
    lossCount: 0,
  };
}
