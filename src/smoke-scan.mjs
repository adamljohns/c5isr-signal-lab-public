// Smoke test: TradingView public scanner, no login, no API key. Prints 5 example tickers.
import { PublicMarketClient } from '../vendor/tradingview-unified-mcp/core/public-market.mjs';
const c = new PublicMarketClient();
const r = await c.scan({ market: 'america', symbols: ['AMEX:SPY', 'NASDAQ:AAPL', 'AMEX:XLV', 'AMEX:XLP', 'NASDAQ:COST'], columns: ['name', 'close', 'change', 'RSI', 'Recommend.All'], limit: 5 });
console.log(JSON.stringify(r, null, 1).slice(0, 1500));
