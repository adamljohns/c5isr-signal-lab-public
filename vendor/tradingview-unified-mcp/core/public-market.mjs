import { ToolError } from './errors.mjs';

// This is the one explicit, credential-free public-data exception to local
// CDP transport. No caller supplies a destination, headers or authentication.
const BASE = 'https://scanner.tradingview.com';
export const SCANNER_MARKETS = Object.freeze(['global', 'america', 'crypto', 'forex', 'futures', 'cfd']);
export const HOTLIST_PRESETS = Object.freeze(['volume_gainers', 'percent_change_gainers', 'percent_change_losers', 'percent_range_gainers', 'percent_range_losers', 'gap_gainers', 'gap_losers', 'percent_gap_gainers', 'percent_gap_losers']);
export const SCANNER_COLUMNS = Object.freeze(['name', 'close', 'change', 'change_abs', 'volume', 'open', 'high', 'low', 'market_cap_basic', 'type', 'subtype', 'description', 'Recommend.All', 'Recommend.MA', 'Recommend.Other', 'RSI', 'MACD.macd']);
export const TA_TIMEFRAMES = Object.freeze(['1', '5', '15', '30', '60', '120', '240', '1D', '1W', '1M']);
const FILTER_FIELDS = new Set(['close', 'change', 'change_abs', 'volume', 'market_cap_basic', 'type', 'subtype']);
const scalar = value => value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 1000;
const fullSymbol = value => typeof value === 'string' && value.length <= 128 && !value.includes('://') && /^[A-Za-z0-9_-]+:[A-Za-z0-9_.$^=+!\/-]+$/.test(value);
const validColumn = column => {
  if (typeof column !== 'string') return false;
  const parts = column.split('|');
  return parts.length <= 2 && SCANNER_COLUMNS.includes(parts[0]) && (parts.length === 1 || TA_TIMEFRAMES.includes(parts[1]) && parts[1] !== '1D');
};
function invalid(message) { throw new ToolError('INVALID_MARKET_REQUEST', message); }

export function preparePublicScan(args = {}) {
  const market = args.market ?? 'global', symbols = args.symbols ?? [], columns = args.columns ?? ['name', 'close', 'change', 'volume'];
  if (!SCANNER_MARKETS.includes(market)) invalid('Unknown scanner market.');
  if (!Array.isArray(symbols) || symbols.length > 100 || !symbols.every(fullSymbol) || new Set(symbols).size !== symbols.length) invalid('Use up to 100 unique exchange-qualified symbols.');
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > 100 || !columns.every(validColumn) || new Set(columns).size !== columns.length) invalid('Unsupported, duplicate or excessive scanner columns.');
  const limit = args.limit ?? 20, offset = args.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) invalid('Invalid scanner result bounds.');
  const filters = args.filters ?? [];
  if (!Array.isArray(filters) || filters.length > 20) invalid('Too many scanner filters.');
  const filter = filters.map(item => {
    if (!item || !FILTER_FIELDS.has(item.field) || !['equal', 'egreater', 'eless'].includes(item.operation)) invalid('Unsupported scanner filter.');
    if (typeof item.value !== 'number' && typeof item.value !== 'string' || !scalar(item.value) || typeof item.value === 'string' && item.value.length > 80) invalid('Invalid scanner filter value.');
    if (item.operation !== 'equal' && typeof item.value !== 'number') invalid('Range filters require finite numbers.');
    return { left: item.field, operation: item.operation, right: item.value };
  });
  // Scanner range is [start, end-exclusive]; a one-row query is [0, 1].
  const body = { symbols: { tickers: [...symbols], query: { types: [] } }, columns: [...columns], range: [offset, offset + limit] };
  if (filter.length) body.filter = filter;
  if (args.sort_by !== undefined) {
    if (!SCANNER_COLUMNS.includes(args.sort_by) || !['asc', 'desc'].includes(args.sort_order ?? 'desc')) invalid('Unsupported scanner sort.');
    body.sort = { sortBy: args.sort_by, sortOrder: args.sort_order ?? 'desc' };
  }
  return { market, columns: [...columns], symbols: [...symbols], limit, offset, body };
}

async function readBounded(response, maxBytes) {
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    try { await response.body?.cancel?.(); } catch { /* The size error remains authoritative. */ }
    throw new ToolError('PUBLIC_MARKET_LIMIT', 'Public market response is too large.');
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > maxBytes) { try { await reader.cancel(); } catch { /* Preserve the bounded-read failure. */ } throw new ToolError('PUBLIC_MARKET_LIMIT', 'Public market response is too large.'); }
        chunks.push(Buffer.from(part.value)); }
      return Buffer.concat(chunks).toString('utf8');
    } finally { reader.releaseLock(); }
  }
  throw new ToolError('PUBLIC_MARKET_SHAPE', 'The public market response has no bounded readable body.');
}

export class PublicMarketClient {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 15000, maxBytes = 4 * 1024 * 1024 } = {}) {
    if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000 || !Number.isInteger(maxBytes) || maxBytes < 128 || maxBytes > 8 * 1024 * 1024) invalid('Invalid internal public-market client limits.');
    this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; this.maxBytes = maxBytes;
  }
  async request(path, body, signal) {
    if (!/^\/(?:global|america|crypto|forex|futures|cfd)\/scan$/.test(path) &&
        !HOTLIST_PRESETS.some(slug => path === '/presets/US_' + slug + '?label-product=right-hotlists')) invalid('Public market request family is not permitted.');
    const url = BASE + path;
    const data = body === undefined ? undefined : JSON.stringify(body);
    if (data && Buffer.byteLength(data) > 128 * 1024) throw new ToolError('PUBLIC_MARKET_LIMIT', 'Public market request is too large.');
    if (signal?.aborted) throw new ToolError('CANCELLED', 'Public market request cancelled.');
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await this.fetchImpl(url, { method: data === undefined ? 'GET' : 'POST',
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: combined,
        headers: { Accept: 'application/json', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
          Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' },
        ...(data === undefined ? {} : { body: data }) });
    } catch {
      if (signal?.aborted) throw new ToolError('CANCELLED', 'Public market request cancelled.');
      throw new ToolError('PUBLIC_MARKET_UNAVAILABLE', 'The credential-free TradingView market request failed. No authenticated fallback or redirect was attempted.');
    }
    if (response.url && response.url !== url) throw new ToolError('PUBLIC_MARKET_DESTINATION', 'The public market response came from an unexpected URL.');
    if (!response.ok) throw new ToolError('PUBLIC_MARKET_HTTP_ERROR', 'TradingView public market service returned an unsuccessful status.', { status: response.status });
    let payload;
    let text;
    try { text = await readBounded(response, this.maxBytes); }
    catch (error) {
      if (error instanceof ToolError) throw error;
      if (signal?.aborted) throw new ToolError('CANCELLED', 'Public market response read cancelled.');
      throw new ToolError('PUBLIC_MARKET_UNAVAILABLE', 'The bounded public market response could not be read.');
    }
    try { payload = JSON.parse(text); } catch { throw new ToolError('PUBLIC_MARKET_SHAPE', 'TradingView returned non-JSON public market data.'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.s === 'error' || payload.error || payload.ok === false) {
      throw new ToolError('PUBLIC_MARKET_SHAPE', 'TradingView returned an error or unexpected public market envelope.');
    }
    return payload;
  }
  async scan(args = {}, { signal } = {}) {
    const request = preparePublicScan(args);
    const payload = await this.request('/' + request.market + '/scan', request.body, signal);
    if (!Array.isArray(payload.data) || payload.data.length > request.limit || !payload.data.every(row => row && fullSymbol(row.s) && Array.isArray(row.d) && row.d.length === request.columns.length && row.d.every(scalar))) {
      throw new ToolError('PUBLIC_MARKET_SHAPE', 'Scanner row identifiers, column count or result bounds do not match the request.');
    }
    const rows = payload.data.map(row => ({ symbol: row.s, values: Object.fromEntries(request.columns.map((column, i) => [column, row.d[i]])) }));
    if (new Set(rows.map(row => row.symbol)).size !== rows.length) throw new ToolError('PUBLIC_MARKET_SHAPE', 'Scanner returned duplicate symbol rows.');
    if (request.symbols.length && rows.some(row => !request.symbols.includes(row.symbol))) throw new ToolError('PUBLIC_MARKET_SYMBOL_MISMATCH', 'Scanner returned an unrequested symbol.');
    return { market: request.market, columns: request.columns, rows, returned: rows.length,
      total_count: Number.isSafeInteger(payload.totalCount) && payload.totalCount >= 0 ? payload.totalCount : null,
      missing_symbols: request.symbols.filter(symbol => !rows.some(row => row.symbol === symbol)),
      retrieved_at: new Date().toISOString(), source: 'tradingview_public_scanner', credentials_used: false,
      freshness: 'service response; exchange delay and underlying quote timestamp are not established' };
  }
  async hotlist({ preset, limit = 20 } = {}, { signal } = {}) {
    if (!HOTLIST_PRESETS.includes(preset) || !Number.isInteger(limit) || limit < 1 || limit > 20) invalid('Unknown preset or invalid hotlist limit.');
    const payload = await this.request('/presets/US_' + preset + '?label-product=right-hotlists', undefined, signal);
    if (!Array.isArray(payload.fields) || payload.fields.length < 1 || payload.fields.length > 20 || !payload.fields.every(value => typeof value === 'string' && value.length <= 100 && /^[A-Za-z0-9_.|]+$/.test(value) && !['__proto__','constructor','prototype'].includes(value)) || new Set(payload.fields).size !== payload.fields.length ||
        !Array.isArray(payload.symbols) || payload.symbols.length > 1000 || !payload.symbols.every(row => row && fullSymbol(row.s) && Array.isArray(row.f) && row.f.length === payload.fields.length && row.f.every(scalar))) {
      throw new ToolError('PUBLIC_MARKET_SHAPE', 'Hotlist response does not match the documented fields/symbols shape.');
    }
    if (new Set(payload.symbols.map(row => row.s)).size !== payload.symbols.length) throw new ToolError('PUBLIC_MARKET_SHAPE', 'Hotlist returned duplicate symbol rows.');
    return { preset, market: 'US', fields: payload.fields,
      rows: payload.symbols.slice(0, limit).map(row => ({ symbol: row.s, values: Object.fromEntries(payload.fields.map((field, i) => [field, row.f[i]])) })),
      total_count: Number.isSafeInteger(payload.totalCount) && payload.totalCount >= 0 ? payload.totalCount : null,
      server_time_ms: typeof payload.time === 'number' && Number.isFinite(payload.time) ? payload.time : null,
      returned: Math.min(payload.symbols.length, limit), truncated: payload.symbols.length > limit,
      source: 'tradingview_public_hotlist', credentials_used: false, retrieved_at: new Date().toISOString() };
  }
}
