/** ANSI color codes for terminal output */
export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
} as const;

/** Format P&L with color: green for profit, red for loss */
export function pnl(value: number, options?: { prefix?: string; decimals?: number }): string {
  const decimals = options?.decimals ?? 2;
  const prefix = options?.prefix ?? '';
  const formatted = `${prefix}${value >= 0 ? '+' : ''}$${value.toFixed(decimals)}`;
  const color = value > 0 ? c.green : value < 0 ? c.red : c.gray;
  return `${color}${formatted}${c.reset}`;
}

/** Format P&L with sign and color for compact display */
export function pnlCompact(value: number, decimals = 2): string {
  const sign = value >= 0 ? '+' : '';
  const formatted = `${sign}$${value.toFixed(decimals)}`;
  const color = value > 0 ? c.green : value < 0 ? c.red : c.gray;
  return `${color}${formatted}${c.reset}`;
}

/** Professional trade execution log */
export function logTradeExecuted(trade: {
  id: number;
  market: string;
  direction: string;
  size: number;
  dydxPrice: number;
  binancePrice: number;
  grossProfitUsd: number;
  feesUsd: number;
  netProfitUsd: number;
  timestamp: string;
}, state: { virtualBalanceUsd: number; totalNetPnl: number; trades: { length: number }; winCount: number; lossCount: number }): void {
  const time = new Date(trade.timestamp).toLocaleTimeString('en-US', { hour12: false });
  const isProfit = trade.netProfitUsd >= 0;

  console.log('');
  console.log(`${c.cyan}${c.bold}┌─ TRADE EXECUTED ─────────────────────────────────${c.reset}`);
  console.log(`${c.gray}│${c.reset} #${trade.id}  ${c.dim}${time}${c.reset}  ${c.yellow}${trade.market}${c.reset}  ${trade.direction}`);
  console.log(`${c.gray}│${c.reset}`);
  console.log(`${c.gray}│${c.reset}  Size:     ${c.white}${trade.size} @ dYdX ${trade.dydxPrice.toFixed(2)} / Binance ${trade.binancePrice.toFixed(2)}${c.reset}`);
  console.log(`${c.gray}│${c.reset}  Gross:    $${trade.grossProfitUsd.toFixed(4)}  ${c.dim}Fees: $${trade.feesUsd.toFixed(4)}${c.reset}`);
  console.log(`${c.gray}│${c.reset}  Net P&L:  ${pnl(trade.netProfitUsd, { decimals: 4 })}`);
  console.log(`${c.gray}│${c.reset}`);
  console.log(`${c.gray}│${c.reset}  Balance:  $${state.virtualBalanceUsd.toFixed(2)}  ${c.dim}Total: ${pnlCompact(state.totalNetPnl)}  ${state.trades.length} trades (${state.winCount}W/${state.lossCount}L)${c.reset}`);
  console.log(`${c.cyan}└───────────────────────────────────────────────────────${c.reset}`);
  console.log('');
}

/** Real-time P&L status string for stdout */
export function pnlStatus(totalNetPnl: number, trades: number, winCount: number, lossCount: number): string {
  const pnlStr = pnlCompact(totalNetPnl);
  const wr = trades > 0 ? ` (${winCount}W/${lossCount}L)` : '';
  return `${c.bold}P&L:${c.reset} ${pnlStr} ${c.dim}| ${trades} trades${wr}${c.reset}`;
}
