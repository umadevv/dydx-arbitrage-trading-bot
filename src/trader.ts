import {
  CompositeClient,
  LocalWallet,
  Network,
  OrderSide,
  SubaccountInfo,
} from '@dydxprotocol/v4-client-js';
import { config } from './config';
import type { ArbitrageOpportunity } from './arbitrage';

const BECH32_PREFIX = 'dydx';

export async function createDydxClient(): Promise<{
  client: CompositeClient;
  subaccount: SubaccountInfo;
}> {
  if (!config.dydx.mnemonic) {
    throw new Error('DYDX_MNEMONIC is required for trading');
  }

  const network =
    config.dydx.network === 'mainnet' ? Network.mainnet() : Network.testnet();
  const wallet = await LocalWallet.fromMnemonic(config.dydx.mnemonic, BECH32_PREFIX);
  const client = await CompositeClient.connect(network);
  const subaccount = new SubaccountInfo(wallet, config.dydx.subaccountNumber);

  return { client, subaccount };
}

/**
 * Place a market order on dYdX (short-term IOC for immediate execution)
 */
export async function placeDydxOrder(
  client: CompositeClient,
  subaccount: SubaccountInfo,
  opportunity: ArbitrageOpportunity
): Promise<string> {
  const side =
    opportunity.direction === 'buy_dydx_sell_binance' ? OrderSide.BUY : OrderSide.SELL;
  const price = opportunity.dydxPrice;
  const size = opportunity.size;

  // Add slippage to price for market order
  const slippageMultiplier = 1 + config.trading.slippageBps / 10_000;
  const orderPrice =
    side === OrderSide.BUY ? price * slippageMultiplier : price / slippageMultiplier;

  const currentBlock = await client.validatorClient.get.latestBlockHeight();
  const goodTilBlock = currentBlock + 15; // Valid for ~15 blocks (~22 sec)
  const clientId = Math.floor(Math.random() * 2 ** 32);

  // TIME_IN_FORCE_IOC = 1 (Immediate-or-Cancel for market-like execution)
  const tx = await client.placeShortTermOrder(
    subaccount,
    opportunity.market,
    side,
    orderPrice,
    size,
    clientId,
    goodTilBlock,
    1 as 0 | 1 | 2 | 3, // Order_TimeInForce.TIME_IN_FORCE_IOC
    false // reduceOnly
  );

  const hash = typeof tx === 'object' && tx.hash ? tx.hash.toString() : String(tx);
  return hash;
}
