/**
 * HTTP / WebSocket reverse proxy for browser-pane targets.
 *
 * Proxies requests from  /proxy/<host>/<port>/…  →  http://<host>:<port>/…
 *
 * This solves the mixed-content problem when devbench is served over HTTPS
 * and browser-pane targets are plain HTTP dev servers.
 *
 * For HTML responses the proxy injects a small script that patches WebSocket
 * and EventSource constructors so they route through the proxy as well.
 * (The service worker handles fetch / XHR / ES-module imports.)
 */

import http from "http";
import net from "net";

// ── Types ────────────────────────────────────────────────────────────

export interface ProxyTarget {
  host: string;
  port: number;
  path: string;          // includes query string
}

// ── URL parsing ──────────────────────────────────────────────────────

const PROXY_RE = /^\/proxy\/([a-zA-Z0-9._-]+)\/(\d+)(\/.*)?$/;

/** Try to parse a /proxy/HOST/PORT/path URL.  Returns null on mismatch. */
export function parseProxyUrl(url: string): ProxyTarget | null {
  const match = url.match(PROXY_RE);
  if (!match) return null;
  return { host: match[1], port: parseInt(match[2]), path: match[3] || "/" };
}

// ── HTTP proxy ───────────────────────────────────────────────────────

/** Forward an HTTP request through the proxy, injecting helpers into HTML. */
export function proxyHttp(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
  target: ProxyTarget,
): void {
  const { host, port, path } = target;
  const proxyPrefix = `/proxy/${host}/${port}`;

  /* ---- build forwarded headers ---- */
  const targetOrigin = `http://${host}:${port}`;
  const headers: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(clientReq.headers)) {
    const lk = k.toLowerCase();
    if (lk === "host" || lk === "accept-encoding") continue;
    // Strip conditional-request headers so we always get the full
    // response body.  We need to inspect & inject into HTML responses
    // and a 304 has no body to inject into.
    if (lk === "if-none-match" || lk === "if-modified-since") continue;
    headers[k] = v;
  }
  headers["host"] = `${host}:${port}`;
  // Ask for uncompressed so we can inspect / rewrite HTML.
  // The hop is local so compression buys nothing here.
  headers["accept-encoding"] = "identity";

  // Rewrite Origin / Referer so the target sees its own origin.
  // Without this, frameworks like Django reject POST requests because
  // the CSRF check compares these headers against the Host.
  if (headers["origin"]) {
    headers["origin"] = targetOrigin;
  }
  if (headers["referer"]) {
    try {
      const ref = new URL(headers["referer"] as string);
      let refPath = ref.pathname;
      if (refPath.startsWith(proxyPrefix)) refPath = refPath.slice(proxyPrefix.length) || "/";
      headers["referer"] = `${targetOrigin}${refPath}${ref.search}`;
    } catch { /* leave as-is */ }
  }

  const proxyReq = http.request(
    { hostname: host, port, path, method: clientReq.method, headers },
    (proxyRes) => {
      const status = proxyRes.statusCode || 200;
      const ct = (proxyRes.headers["content-type"] || "").toLowerCase();
      const isHtml = ct.includes("text/html");

      /* ---- response headers ---- */
      const rh: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (v != null) rh[k] = v as string | string[];
      }

      // Rewrite Location for redirects
      if (rh["location"]) {
        rh["location"] = rewriteLocation(rh["location"] as string, host, port, proxyPrefix);
      }

      // The SW relies on the Referer to detect proxy context
      rh["referrer-policy"] = "same-origin";

      // Don't let the target block iframe embedding
      delete rh["content-security-policy"];
      delete rh["content-security-policy-report-only"];
      delete rh["x-frame-options"];

      if (isHtml && status >= 200 && status < 300) {
        /* ---- buffer & rewrite HTML ---- */
        const chunks: Buffer[] = [];
        proxyRes.on("data", (c: Buffer) => chunks.push(c));
        proxyRes.on("end", () => {
          let html = Buffer.concat(chunks).toString("utf8");
          html = injectProxyScript(html, proxyPrefix);
          delete rh["content-length"];
          delete rh["content-encoding"];
          // Remove upstream caching headers — the injected content differs
          // from the original so the upstream etag is no longer valid.
          delete rh["etag"];
          delete rh["last-modified"];
          rh["cache-control"] = "no-store";
          rh["content-length"] = String(Buffer.byteLength(html));
          clientRes.writeHead(status, rh);
          clientRes.end(html);
        });
        proxyRes.on("error", () => {
          if (!clientRes.headersSent) { clientRes.writeHead(502); clientRes.end("Proxy stream error"); }
        });
      } else {
        /* ---- stream everything else directly ---- */
        clientRes.writeHead(status, rh);
        proxyRes.pipe(clientRes);
      }
    },
  );

  proxyReq.on("error", (err) => {
    console.error(`[proxy] ${clientReq.method} http://${host}:${port}${path} →`, err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "Content-Type": "text/plain" });
      clientRes.end(`Proxy error: ${err.message}`);
    }
  });

  clientReq.pipe(proxyReq);
}

// ── WebSocket proxy (raw TCP) ────────────────────────────────────────

/** Forward a WebSocket upgrade through the proxy at the TCP level. */
export function proxyUpgrade(
  req: http.IncomingMessage,
  clientSocket: net.Socket,
  head: Buffer,
  target: ProxyTarget,
): void {
  const { host, port, path } = target;

  const targetSocket = net.connect(port, host, () => {
    // Reconstruct the HTTP/1.1 upgrade request for the target
    let raw = `${req.method} ${path} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i];
      const val = req.rawHeaders[i + 1];
      raw += key.toLowerCase() === "host" ? `Host: ${host}:${port}\r\n` : `${key}: ${val}\r\n`;
    }
    raw += "\r\n";

    targetSocket.write(raw);
    if (head.length) targetSocket.write(head);

    // Bidirectional pipe
    targetSocket.pipe(clientSocket);
    clientSocket.pipe(targetSocket);
  });

  const cleanup = () => { targetSocket.destroy(); clientSocket.destroy(); };
  targetSocket.on("error", cleanup);
  clientSocket.on("error", cleanup);
  targetSocket.on("close", cleanup);
  clientSocket.on("close", cleanup);
}

// ── Internal helpers ─────────────────────────────────────────────────

function rewriteLocation(
  location: string, host: string, port: number, prefix: string,
): string {
  try {
    const u = new URL(location, `http://${host}:${port}`);
    if (u.hostname === host && (u.port || "80") === String(port)) {
      return `${prefix}${u.pathname}${u.search}`;
    }
  } catch { /* leave as-is */ }
  return location;
}

/** Inject the proxy-patching <script> into an HTML string. */
function injectProxyScript(html: string, prefix: string): string {
  const tag = `<script>${buildPatchScript(prefix)}</script>`;

  // Prefer right after <head …>
  const m = html.match(/<head[^>]*>/i);
  if (m) { const i = m.index! + m[0].length; return html.slice(0, i) + tag + html.slice(i); }

  // Fallback: right after <html …>
  const m2 = html.match(/<html[^>]*>/i);
  if (m2) { const i = m2.index! + m2[0].length; return html.slice(0, i) + tag + html.slice(i); }

  return tag + html;   // last resort
}

/**
 * Build a self-contained JS snippet that patches browser APIs so all
 * network requests from the proxied page route through /proxy/HOST/PORT.
 *
 * We patch fetch, XMLHttpRequest, WebSocket, and EventSource directly
 * rather than relying solely on the service worker, because client-side
 * routers (pushState) can move the document URL outside the /proxy/
 * prefix — which breaks the SW's referrer-based detection.
 */
function buildPatchScript(prefix: string): string {
  return `(function(){
var P=${JSON.stringify(prefix)};
function rw(u){try{
var p=new URL(u,location.href);
if(p.origin===location.origin&&!p.pathname.startsWith("/proxy/"))return P+p.pathname+p.search;
if(p.protocol==="http:"||p.protocol==="ws:"){
var s=location.protocol==="https:"?(p.protocol==="ws:"?"wss:":"https:"):p.protocol;
return s+"//"+location.host+"/proxy/"+p.hostname+"/"+(p.port||"80")+p.pathname+p.search}
}catch(e){}return u}
var _f=window.fetch;
window.fetch=function(i,o){
if(typeof i==="string")i=rw(i);
else if(i instanceof Request){var nu=rw(i.url);if(nu!==i.url)i=new Request(nu,i)}
return _f.call(this,i,o)};
var _xo=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(){
var a=Array.prototype.slice.call(arguments);
if(typeof a[1]==="string")a[1]=rw(a[1]);
return _xo.apply(this,a)};
var WS=window.WebSocket;
window.WebSocket=function(u,p){return p!=null?new WS(rw(u),p):new WS(rw(u))};
window.WebSocket.prototype=WS.prototype;
window.WebSocket.CONNECTING=0;window.WebSocket.OPEN=1;window.WebSocket.CLOSING=2;window.WebSocket.CLOSED=3;
if(window.EventSource){var ES=window.EventSource;
window.EventSource=function(u,o){return new ES(rw(u),o)};
window.EventSource.prototype=ES.prototype}
})();`;
}
