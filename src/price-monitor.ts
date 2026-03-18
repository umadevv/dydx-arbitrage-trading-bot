import { config, getIndexerUrl } from './config';

export interface OrderbookLevel {
  price: string;
  size: string;
}

export interface Orderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
}

export interface PriceSnapshot {
  market: string;
  dydx: {
    bestBid: number;
    bestAsk: number;
    mid: number;
    spread: number;
  };
  binance: {
    bid: number;
    ask: number;
    mid: number;
  };
  timestamp: number;
}

async function fetchWithTimeout(url: string, retries = 3): Promise<Response> {
  const timeout = config.trading.fetchTimeoutMs;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (err) {
      clearTimeout(id);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Fetch failed after retries');
}

/**
 * Fetch dYdX orderbook from Indexer REST API
 */
export async function fetchDydxOrderbook(market: string): Promise<Orderbook> {
  const url = `${getIndexerUrl()}/v4/orderbooks/perpetualMarket/${market}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`dYdX orderbook fetch failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { bids: OrderbookLevel[]; asks: OrderbookLevel[] };
  return {
    bids: data.bids ?? [],
    asks: data.asks ?? [],
  };
}

/**
 * Fetch Binance spot orderbook (for price reference)
 * Binance uses symbol format ETHUSDT for ETH-USD
 * Note: Binance may return 451 in some regions - use fetchCoinGeckoPrice as fallback
 */
export async function fetchBinanceOrderbook(baseSymbol: string): Promise<Orderbook | null> {
  try {
    const binanceSymbol = baseSymbol + 'USDT';
    const url = `${config.endpoints.binance}/api/v3/depth?symbol=${binanceSymbol}&limit=5`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { bids: [string, string][]; asks: [string, string][] };
    return {
      bids: (data.bids ?? []).map(([price, size]) => ({ price, size })),
      asks: (data.asks ?? []).map(([price, size]) => ({ price, size })),
    };
  } catch {
    return null;
  }
}

/**
 * Kraken orderbook (fallback when Binance blocked)
 */
async function fetchKrakenOrderbook(baseSymbol: string): Promise<Orderbook | null> {
  try {
    const pairs: Record<string, string> = { BTC: 'XBTUSD', ETH: 'ETHUSD', SOL: 'SOLUSD' };
    const pair = pairs[baseSymbol] ?? baseSymbol + 'USD';
    const res = await fetchWithTimeout(
      `https://api.kraken.com/0/public/Depth?pair=${pair}&count=5`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: Record<string, { bids: [string, string, number][]; asks: [string, string, number][] }> };
    const book = data.result?.[pair] ?? Object.values(data.result ?? {})[0];
    if (!book) return null;
    return {
      bids: (book.bids ?? []).map(([price, size]) => ({ price, size })),
      asks: (book.asks ?? []).map(([price, size]) => ({ price, size })),
    };
  } catch {
    return null;
  }
}

/**
 * Fallback: Fetch price from CoinGecko (no API key, rate limited)
 */
async function fetchCoinGeckoPrice(baseSymbol: string): Promise<{ bid: number; ask: number } | null> {
  try {
    const ids: Record<string, string> = { ETH: 'ethereum', BTC: 'bitcoin', SOL: 'solana' };
    const id = ids[baseSymbol] ?? baseSymbol.toLowerCase();
    const res = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { usd: number }>;
    const price = data[id]?.usd;
    if (!price) return null;
    return { bid: price * 0.999, ask: price * 1.001 };
  } catch {
    return null;
  }
}

/**
 * Get best bid/ask from orderbook. Handles {price,size} and [price,size] formats.
 */
function getBestPrices(book: Orderbook): { bid: number; ask: number } {
  const toPrice = (x: OrderbookLevel | [string, string]) =>
    Array.isArray(x) ? parseFloat(x[0]) : parseFloat(x.price);
  const bids = (book.bids ?? []).map(toPrice).filter((p) => !isNaN(p) && p > 0);
  const asks = (book.asks ?? []).map(toPrice).filter((p) => !isNaN(p) && p > 0);
  return {
    bid: bids.length ? Math.max(...bids) : 0,
    ask: asks.length ? Math.min(...asks) : 0,
  };
}

/**
 * Fetch prices for a single market
 */
async function fetchPricesForMarket(market: string): Promise<PriceSnapshot> {
  const baseSymbol = market.split('-')[0];

  const [dydxBook, binanceBook] = await Promise.all([
    fetchDydxOrderbook(market),
    fetchBinanceOrderbook(baseSymbol),
  ]);

  const dydx = getBestPrices(dydxBook);
  let binancePrices = binanceBook ? getBestPrices(binanceBook) : null;
  if (!binancePrices) {
    const krakenBook = await fetchKrakenOrderbook(baseSymbol);
    binancePrices = krakenBook ? getBestPrices(krakenBook) : null;
  }
  if (!binancePrices) {
    binancePrices = (await fetchCoinGeckoPrice(baseSymbol)) ?? { bid: dydx.bid, ask: dydx.ask };
  }

  return {
    market,
    dydx: {
      bestBid: dydx.bid,
      bestAsk: dydx.ask,
      mid: (dydx.bid + dydx.ask) / 2,
      spread: dydx.ask - dydx.bid,
    },
    binance: {
      bid: binancePrices.bid,
      ask: binancePrices.ask,
      mid: (binancePrices.bid + binancePrices.ask) / 2,
    },
    timestamp: Date.now(),
  };
}

/**
 * Fetch prices for all configured markets in parallel
 */
export async function fetchAllPrices(): Promise<PriceSnapshot[]> {
  const markets = config.dydx.markets;
  return Promise.all(markets.map((m) => fetchPricesForMarket(m)));
}

/**
 * HFT: Fetch prices using WebSocket dYdX + REST Binance (faster)
 */
export async function fetchAllPricesHFT(
  getDydxPrices: (market: string) => { bid: number; ask: number } | null
): Promise<PriceSnapshot[]> {
  const markets = config.dydx.markets;
  const binancePromises = markets.map(async (market) => {
    const base = market.split('-')[0];
    let binancePrices: { bid: number; ask: number } | null = null;
    const binanceBook = await fetchBinanceOrderbook(base);
    if (binanceBook) binancePrices = getBestPrices(binanceBook);
    if (!binancePrices) {
      const krakenBook = await fetchKrakenOrderbook(base);
      if (krakenBook) binancePrices = getBestPrices(krakenBook);
    }
    if (!binancePrices) {
      binancePrices = (await fetchCoinGeckoPrice(base)) ?? { bid: 0, ask: 0 };
    }
    return { market, binancePrices };
  });

  const binanceResults = await Promise.all(binancePromises);
  const now = Date.now();

  return binanceResults.map(({ market, binancePrices }) => {
    const dydx = getDydxPrices(market);
    const dydxBid = dydx?.bid ?? 0;
    const dydxAsk = dydx?.ask ?? 0;
    return {
      market,
      dydx: {
        bestBid: dydxBid,
        bestAsk: dydxAsk,
        mid: (dydxBid + dydxAsk) / 2 || (binancePrices.bid + binancePrices.ask) / 2,
        spread: dydxAsk - dydxBid,
      },
      binance: {
        bid: binancePrices.bid,
        ask: binancePrices.ask,
        mid: (binancePrices.bid + binancePrices.ask) / 2,
      },
      timestamp: now,
    };
  });
}

/** @deprecated Use fetchAllPrices for multi-market */
export async function fetchPrices(): Promise<PriceSnapshot> {
  const markets = config.dydx.markets;
  return fetchPricesForMarket(markets[0] ?? 'BTC-USD');
}
