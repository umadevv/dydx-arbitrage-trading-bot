/**
 * HFT: Real-time dYdX orderbook via WebSocket
 * Maintains live best bid/ask for each market
 */
import WebSocket from 'ws';
import { config, getWebSocketUrl } from './config';

const WS_URL = getWebSocketUrl();

type OrderbookLevel = [number, number, number]; // [price, size, offset]

const orderbooks: Record<string, { bids: OrderbookLevel[]; asks: OrderbookLevel[] }> = {};
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function getBestFromLevels(levels: OrderbookLevel[]): number {
  if (levels.length === 0) return 0;
  return levels[0][0];
}

function sortBidsDesc(arr: OrderbookLevel[]): void {
  arr.sort((a, b) => b[0] - a[0]);
}
function sortAsksAsc(arr: OrderbookLevel[]): void {
  arr.sort((a, b) => a[0] - b[0]);
}

function updateLevels(
  levels: OrderbookLevel[],
  updates: Array<{ price: number; size: number }>,
  messageId: number
): void {
  for (const u of updates) {
    const idx = levels.findIndex((l) => l[0] === u.price);
    if (u.size === 0) {
      if (idx >= 0) levels.splice(idx, 1);
    } else {
      if (idx >= 0) {
        levels[idx][1] = u.size;
        levels[idx][2] = messageId;
      } else {
        levels.push([u.price, u.size, messageId]);
      }
    }
  }
}

function uncrossOrderbook(bids: OrderbookLevel[], asks: OrderbookLevel[]): void {
  while (bids.length > 0 && asks.length > 0 && bids[0][0] >= asks[0][0]) {
    const b = bids[0];
    const a = asks[0];
    if (b[2] < a[2]) bids.shift();
    else if (b[2] > a[2]) asks.shift();
    else {
      if (b[1] > a[1]) {
        b[1] -= a[1];
        asks.shift();
      } else if (b[1] < a[1]) {
        a[1] -= b[1];
        bids.shift();
      } else {
        bids.shift();
        asks.shift();
      }
    }
  }
}

function processMessage(data: string, market: string): void {
  try {
    const msg = JSON.parse(data);
    const contents = msg.contents;
    const messageId = msg.message_id ?? 0;

    if (!orderbooks[market]) {
      orderbooks[market] = { bids: [], asks: [] };
    }
    const ob = orderbooks[market];

    if (Array.isArray(contents)) {
      for (const entry of contents) {
        if (entry.bids) {
          const raw = Array.isArray(entry.bids[0]) ? entry.bids : [entry.bids];
          const bidUpdates = raw.map((b: (string | number)[] | { price: string; size: string }) =>
            Array.isArray(b) ? { price: Number(b[0]), size: Number(b[1]) } : { price: Number((b as { price: string; size: string }).price), size: Number((b as { price: string; size: string }).size) }
          );
          updateLevels(ob.bids, bidUpdates, messageId);
        }
        if (entry.asks) {
          const raw = Array.isArray(entry.asks[0]) ? entry.asks : [entry.asks];
          const askUpdates = raw.map((a: (string | number)[] | { price: string; size: string }) =>
            Array.isArray(a) ? { price: Number(a[0]), size: Number(a[1]) } : { price: Number((a as { price: string; size: string }).price), size: Number((a as { price: string; size: string }).size) }
          );
          updateLevels(ob.asks, askUpdates, messageId);
        }
      }
    } else if (contents?.bids || contents?.asks) {
      ob.bids.length = 0;
      ob.asks.length = 0;
      for (const b of contents.bids ?? []) {
        const item = typeof b === 'object' && !Array.isArray(b) ? b : { price: (b as number[])[0], size: (b as number[])[1] };
        ob.bids.push([Number(item.price), Number(item.size), messageId]);
      }
      for (const a of contents.asks ?? []) {
        const item = typeof a === 'object' && !Array.isArray(a) ? a : { price: (a as number[])[0], size: (a as number[])[1] };
        ob.asks.push([Number(item.price), Number(item.size), messageId]);
      }
    }

    sortBidsDesc(ob.bids);
    sortAsksAsc(ob.asks);
    uncrossOrderbook(ob.bids, ob.asks);
  } catch {
    // ignore parse errors
  }
}

function connect(): void {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    for (const market of config.dydx.markets) {
      ws?.send(JSON.stringify({ type: 'subscribe', channel: 'v4_orderbook', id: market }));
    }
  });

  ws.on('message', (data: Buffer) => {
    const str = data.toString();
    if (str === 'PING') {
      ws?.send('PONG');
      return;
    }
    try {
      const msg = JSON.parse(str);
      if (msg.type === 'connected' || msg.type === 'subscribed') return;
      const market = msg.id ?? msg.channel_id ?? config.dydx.markets[0];
      processMessage(str, market);
    } catch {
      // ignore
    }
  });

  ws.on('close', () => {
    ws = null;
    if (config.trading.hftMode) {
      reconnectTimer = setTimeout(connect, 1000);
    }
  });

  ws.on('error', () => {
    // reconnect on error
  });
}

export function startPriceStream(): void {
  connect();
}

export function stopPriceStream(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
}

export function getDydxBestPrices(market: string): { bid: number; ask: number } | null {
  const ob = orderbooks[market];
  if (!ob || ob.bids.length === 0 || ob.asks.length === 0) return null;
  return {
    bid: getBestFromLevels(ob.bids),
    ask: getBestFromLevels(ob.asks),
  };
}

export function isStreamReady(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}
