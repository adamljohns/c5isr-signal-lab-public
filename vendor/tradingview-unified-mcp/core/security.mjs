import { createHash, timingSafeEqual } from 'node:crypto';
import { ToolError } from './errors.mjs';

export const TV_HOSTS = Object.freeze(['www.tradingview.com', 'tradingview.com']);
export const TV_REQUEST_HOSTS = Object.freeze([
  ...TV_HOSTS, 'pricealerts.tradingview.com', 'pine-facade.tradingview.com',
  'symbol-search.tradingview.com', 'scanner.tradingview.com',
]);
const LOCAL_HOSTS = new Set(['127.0.0.1', '[::1]']);
const SECRET_KEY = /^(?:cookie|cookies|set-cookie|authorization|proxy-authorization|password|passwd|sessionid|session_id|sessionid_sign|device_t|access_token|refresh_token|csrf_token|csrftoken|api_key|apikey|secret|client_secret|token|auth_token|bearer_token|accessToken|refreshToken|apiKey|clientSecret)$/i;

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function assertCdpEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new ToolError('INVALID_CDP_ENDPOINT', 'CDP endpoint must be an HTTP loopback URL.'); }
  if (url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new ToolError('INVALID_CDP_ENDPOINT', 'Use http://127.0.0.1:9222 or a literal IPv6 loopback endpoint; remote hosts, localhost aliases and credentials are refused.');
  }
  return url.origin;
}

export function assertDebuggerUrl(value, endpoint) {
  const url = new URL(value);
  const base = new URL(assertCdpEndpoint(endpoint));
  if (url.protocol !== 'ws:' || url.hostname !== base.hostname || url.port !== base.port || url.username || url.password || url.search || url.hash || !/^\/devtools\/(?:page|browser)\/[a-zA-Z0-9_-]+$/.test(url.pathname)) {
    throw new ToolError('UNSAFE_DEBUGGER_URL', 'Chrome returned a debugger URL outside the configured loopback endpoint.');
  }
  return url.href;
}

export function assertTradingViewUrl(value, { chartOnly = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new ToolError('INVALID_TV_URL', 'A full HTTPS TradingView URL is required.'); }
  if (url.protocol !== 'https:' || !TV_HOSTS.includes(url.hostname) || url.port || url.username || url.password || (chartOnly && !/^\/chart(?:\/|$)/.test(url.pathname))) {
    throw new ToolError('UNSAFE_ORIGIN', 'Only HTTPS tradingview.com/www.tradingview.com chart pages are permitted.');
  }
  return url.href;
}

export function validateWebhook(value) {
  let url;try{url=new URL(value);}catch{throw new ToolError('INVALID_WEBHOOK','Webhook must be a full HTTPS URL.');}
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !url.hostname.includes('.') || url.hostname.startsWith('[')) {
    throw new ToolError('INVALID_WEBHOOK', 'Webhook must be HTTPS on port 443, with no embedded credentials or IPv6 literal.');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new ToolError('INVALID_WEBHOOK', 'Use a publicly reachable webhook endpoint. The MCP server never sends a test request to it.');
  }
  return url.href;
}

export function redact(value, depth = 0) {
  if (depth > 20) return '[depth limit]';
  if (typeof value === 'string') {
    // Tool fields can contain serialized JSON, including exported cookie
    // records. Preserve original bytes unless a nested value needs redaction.
    if(/^\s*[\[{]/.test(value)){
      try{const parsed=JSON.parse(value),cleaned=JSON.stringify(redact(parsed,depth+1));if(cleaned!==JSON.stringify(parsed))return cleaned;}catch{/* Source/templates need not be JSON. */}
    }
    return value.replace(/(["'])(cookie|cookies|set-cookie|authorization|proxy-authorization|password|passwd|sessionid|session_id|sessionid_sign|access_token|refresh_token|csrf_token|csrftoken|api_key|apikey|apiKey|secret|client_secret|clientSecret|token|auth_token|bearer_token|accessToken|refreshToken)\1\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi, (_match, quote, key) => `${quote}${key}${quote}: ${quote}[REDACTED]${quote}`)
      .replace(/\b(?:Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
      .replace(/\b(sessionid|sessionid_sign|csrftoken|access_token|refresh_token|api_key|password)=([^\s;&]+)/gi, '$1=[REDACTED]')
      .replace(/\b(sessionid|sessionid_sign|csrftoken|access_token|refresh_token|api_key|password|token|secret)\s*:\s*[^\s,;}]+/gi, '$1: [REDACTED]')
      .replace(/([?&](?:token|access_token|refresh_token|api_key|key|secret|auth|password|signature|sessionid)=)[^&#\s]*/gi, '$1[REDACTED]')
      .replace(/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/g, '[REDACTED_PROVIDER_KEY]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  }
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key) || key==='value' && typeof value.name==='string' && SECRET_KEY.test(value.name)) out[key] = '[REDACTED]';
      else out[key] = redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

export function publicChartUrl(value){const u=new URL(assertTradingViewUrl(value,{chartOnly:true}));for(const key of [...u.searchParams.keys()])if(!['symbol','interval','theme','style'].includes(key))u.searchParams.delete(key);u.hash='';return u.href;}

export function assertFixedFunction(fn) {
  if (typeof fn !== 'function') throw new ToolError('UNSAFE_EVALUATION', 'Only module-authored functions may execute in the TradingView page.');
  const source = Function.prototype.toString.call(fn);
  const forbidden = [
    /\bdocument\s*(?:\.\s*cookie|\[\s*['"]cookie['"]\s*\])/i,
    /\b(?:localStorage|sessionStorage|indexedDB)\b/,
    /\b(?:getCookies|getAllCookies|storageState|setCookie|setCookies)\b/,
    /\b(?:eval|Function)\s*\(/,
    /\b(?:WebSocket|EventSource|XMLHttpRequest)\s*\(/,
    /\b(?:sendBeacon)\s*\(/,
    /(?:window|globalThis)\s*\.\s*fetch\s*\(/,
    /\b(?:__proto__|constructor\s*\[)\b/,
  ];
  if (forbidden.some(re => re.test(source))) throw new ToolError('UNSAFE_EVALUATION', 'This page function contains a prohibited credential, storage, network, or dynamic-code operation.');
  return source;
}

export function safeTokenEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
