// @lat: [[browser-pane#Reverse Proxy]]
/**
 * HTTP / WebSocket reverse proxy for browser-pane targets.
 *
 * Proxies requests from  /proxy/<host>/<port>/…         →  http://<host>:<port>/…
 *                 or  /proxy-mobile/<host>/<port>/…  →  http://<host>:<port>/…
 *
 * This solves the mixed-content problem when devbench is served over HTTPS
 * and browser-pane targets are plain HTTP dev servers.
 *
 * For HTML responses the proxy injects a small script that patches WebSocket
 * and EventSource constructors so they route through the proxy as well.
 * (The service worker handles fetch / XHR / ES-module imports.)
 *
 * The /proxy-mobile/ variant additionally injects a device-emulation script
 * that patches navigator UA/touch properties, media queries, and synthesizes
 * TouchEvents from mouse events so desktop pointers drive mobile UIs — the
 * same behavior as Chrome DevTools' device toolbar. See [[browser-pane#Mobile Device Emulation]].
 */

import http from "http";
import net from "net";

// ── Types ────────────────────────────────────────────────────────────

export interface ProxyTarget {
  host: string;
  port: number;
  path: string;          // includes query string
  mobile: boolean;       // true when the request came via /proxy-mobile/
}

// ── URL parsing ──────────────────────────────────────────────────────

const PROXY_RE = /^\/(proxy|proxy-mobile)\/([a-zA-Z0-9._-]+)\/(\d+)(\/.*)?$/;

/** Try to parse a /proxy/HOST/PORT/path or /proxy-mobile/HOST/PORT/path URL.  Returns null on mismatch. */
export function parseProxyUrl(url: string): ProxyTarget | null {
  const match = url.match(PROXY_RE);
  if (!match) return null;
  return {
    host: match[2],
    port: parseInt(match[3]),
    path: match[4] || "/",
    mobile: match[1] === "proxy-mobile",
  };
}

// ── HTTP proxy ───────────────────────────────────────────────────────

/** Forward an HTTP request through the proxy, injecting helpers into HTML. */
export function proxyHttp(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
  target: ProxyTarget,
): void {
  const { host, port, path, mobile } = target;
  const proxyPrefix = `/${mobile ? "proxy-mobile" : "proxy"}/${host}/${port}`;

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
          html = injectProxyScript(html, proxyPrefix, mobile);
          delete rh["content-length"];
          delete rh["content-encoding"];
          // Strip transfer-encoding too — otherwise setting Content-Length
          // alongside the upstream's `transfer-encoding: chunked` produces an
          // invalid response that Node's HTTP parser rejects as
          // HPE_INVALID_CONTENT_LENGTH ("Content-Length can't be present with
          // Transfer-Encoding"), and the iframe silently fails to load.
          delete rh["transfer-encoding"];
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
function injectProxyScript(html: string, prefix: string, mobile: boolean): string {
  // The mobile emulation script must run BEFORE the URL-rewriter patch so
  // that navigator.userAgent etc. are already mutated by the time the page's
  // own bootstrap JS reads them.
  const mobileTag = mobile ? `<script>${buildMobileEmulationScript()}</script>` : "";
  const tag = `${mobileTag}<script>${buildPatchScript(prefix)}</script>`;

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
  // `prefix` is either /proxy/HOST/PORT or /proxy-mobile/HOST/PORT.  Derive
  // the mode root (/proxy or /proxy-mobile) so external URL rewrites keep the
  // iframe in the same emulation mode across navigations.
  const modeRoot = prefix.startsWith("/proxy-mobile/") ? "/proxy-mobile" : "/proxy";
  return `(function(){
var P=${JSON.stringify(prefix)};
var M=${JSON.stringify(modeRoot)};
if(location.pathname.indexOf(P)===0){
var _c=location.pathname.slice(P.length)||'/';
history.replaceState(history.state,'',_c+location.search+location.hash)}
function rw(u){try{
var p=new URL(u,location.href);
if(p.origin===location.origin){
if(/^\\/proxy(-mobile)?\\//.test(p.pathname))return u;
return P+p.pathname+p.search}
if(p.protocol==="http:"||p.protocol==="ws:"){
var s=location.protocol==="https:"?(p.protocol==="ws:"?"wss:":"https:"):p.protocol;
return s+"//"+location.host+M+"/"+p.hostname+"/"+(p.port||"80")+p.pathname+p.search}
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

/**
 * Build a self-contained JS snippet that emulates a mobile device inside an
 * otherwise desktop browser iframe.  Mirrors what Chrome DevTools' device
 * toolbar does when Touch is enabled, with a few adaptations for the fact
 * that we can't flip the renderer's native touch-emulation flag from JS:
 *
 *   • Override navigator UA, platform, vendor, maxTouchPoints so feature
 *     detection picks up a mobile Safari iPhone.  Runtime properties are
 *     also written so `window.ontouchstart`, `window.ontouchmove`, etc.
 *     exist as sentinel keys for `'ontouchstart' in window` checks.
 *   • Patch `window.matchMedia` so (hover: none), (pointer: coarse),
 *     (any-hover: none), (any-pointer: coarse) all report as matching, and
 *     (hover: hover) / (pointer: fine) report as not matching.
 *   • Inject a stylesheet that disables `user-select`, `-webkit-touch-
 *     callout`, and the tap-highlight colour site-wide so dragging with a
 *     desktop mouse no longer highlights text the way a real mobile browser
 *     wouldn't.  Form fields (input, textarea, select, contenteditable) are
 *     re-enabled so the user can still select and edit.
 *   • Cancel the browser's default `selectstart` and `dragstart` actions so
 *     neither long-press text selection nor HTML5 drag-and-drop fire.
 *   • In capture phase, synthesize PointerEvents with `pointerType: "touch"`
 *     and — where the browser allows construction — real TouchEvents with
 *     one Touch point tracking the cursor.  Desktop Chrome typically refuses
 *     `new Touch(…)` and `new TouchEvent(…)` ("Illegal constructor") because
 *     the native feature flag is off; in that case we fall back to a
 *     `UIEvent` whose `type` matches and whose `touches` / `targetTouches` /
 *     `changedTouches` are attached as own properties.  Listeners registered
 *     through `addEventListener('touchstart', …)` still fire for these.
 *   • Call `preventDefault()` on the originating mouse events (except on
 *     form fields) so the native drag-selection, focus-steal, and ghost
 *     drag-image behaviors don't fight the synthetic touch stream.
 *   • Implement drag-to-scroll with inertia in JS.  Synthetic touch events
 *     are not user gestures, so Chromium's compositor doesn't translate them
 *     into native scroll the way it would for real finger input — lists,
 *     panels, and `overflow:auto` regions would otherwise not respond to
 *     mouse drags at all.  On mousedown we walk up from the target looking
 *     for the nearest scrollable ancestor on each axis (using
 *     `getComputedStyle(overflow(X|Y))` and `scroll(Height|Width) >
 *     client(Height|Width)`), falling back to `document.scrollingElement`.
 *     On each mousemove we apply the inverse delta to that element's
 *     `scrollTop`/`scrollLeft` (so dragging down reveals content above,
 *     matching mobile conventions).  Recent deltas are kept in a 100 ms
 *     ring buffer, and on mouseup the averaged velocity drives a
 *     `requestAnimationFrame` inertia loop with exponential decay (time
 *     constant ~325 ms).  If the page calls `preventDefault()` on our
 *     dispatched touchmove — the standard mobile opt-out for carousels,
 *     sliders, pull-to-refresh, etc. — we skip the auto-scroll and
 *     inertia entirely so the page's own gesture logic wins.
 *   • Axis-lock gestures like real mobile browsers: once movement exceeds a
 *     10 px threshold, decide whether the gesture is horizontal or vertical
 *     using a 1.5× dominance ratio, tie-breaking toward whichever axis the
 *     innermost scrollable ancestor of the start target can actually scroll
 *     in.  A pointer that starts inside an `overflow-x: auto` tab strip
 *     therefore locks to horizontal scrolling even when the drag picks up a
 *     few pixels of vertical jitter first — only a clear >1.5× vertical
 *     dominance escapes to the outer page's vertical scroll.  Inertia is
 *     likewise clamped to the locked axis.
 *   • Suppress the "ghost click" that the browser would otherwise synthesize
 *     from `mousedown`+`mouseup` at the end of a drag gesture.  A capture-
 *     phase `click` listener swallows the next click event (via
 *     `stopImmediatePropagation` + `preventDefault`) whenever the gesture
 *     moved more than 10 px from its start point; the suppression flag
 *     auto-clears after 500 ms so genuine taps still navigate.
 *
 * The script is intentionally written without ES2015 syntax so it runs in
 * any target page, and uses `try`/`catch` around every `defineProperty` so a
 * single failure doesn't break the rest.
 */
// @lat: [[browser-pane#Mobile Device Emulation]]
function buildMobileEmulationScript(): string {
  return `(function(){
var UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
function def(o,k,v){try{Object.defineProperty(o,k,{get:function(){return v},configurable:true})}catch(e){}}
def(navigator,"userAgent",UA);
def(navigator,"platform","iPhone");
def(navigator,"vendor","Apple Computer, Inc.");
def(navigator,"maxTouchPoints",5);
try{window.ontouchstart=null}catch(e){}
try{window.ontouchmove=null}catch(e){}
try{window.ontouchend=null}catch(e){}
try{window.ontouchcancel=null}catch(e){}
var _mm=window.matchMedia&&window.matchMedia.bind(window);
if(_mm){window.matchMedia=function(q){var r=_mm(q);var s=String(q||"");var o=null;
if(/\\((?:any-)?hover\\s*:\\s*none\\)/.test(s))o=true;
else if(/\\((?:any-)?hover\\s*:\\s*hover\\)/.test(s))o=false;
else if(/\\((?:any-)?pointer\\s*:\\s*coarse\\)/.test(s))o=true;
else if(/\\((?:any-)?pointer\\s*:\\s*fine\\)/.test(s))o=false;
if(o===null)return r;
return{media:r.media,matches:o,onchange:null,
addListener:function(){},removeListener:function(){},
addEventListener:function(){},removeEventListener:function(){},
dispatchEvent:function(){return false}}}}
var CSS="*{-webkit-tap-highlight-color:transparent!important;-webkit-touch-callout:none!important}html,body{-webkit-user-select:none!important;-ms-user-select:none!important;user-select:none!important}input,textarea,select,[contenteditable=\\"\\"],[contenteditable=\\"true\\"]{-webkit-user-select:auto!important;user-select:auto!important}";
function addStyles(){try{if(document.querySelector("style[data-devbench-mobile]"))return;var s=document.createElement("style");s.setAttribute("data-devbench-mobile","");s.textContent=CSS;(document.head||document.documentElement).appendChild(s)}catch(e){}}
addStyles();
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",addStyles,true);
function isFormField(el){if(!el||!el.tagName)return false;var t=el.tagName;if(t==="INPUT"||t==="TEXTAREA"||t==="SELECT")return true;try{if(el.isContentEditable)return true}catch(e){}return false}
var canTouch=false;try{new Touch({identifier:0,target:document.documentElement,clientX:0,clientY:0});canTouch=true}catch(e){}
function makeTouch(ev,target){var init={identifier:tid,target:target,clientX:ev.clientX,clientY:ev.clientY,screenX:ev.screenX,screenY:ev.screenY,pageX:ev.pageX,pageY:ev.pageY,radiusX:1,radiusY:1,rotationAngle:0,force:1};if(canTouch){try{return new Touch(init)}catch(e){}}return init}
function dispatchTouch(type,ev,target){var t=makeTouch(ev,target);var end=(type==="touchend"||type==="touchcancel");var touches=end?[]:[t];var te=null;if(canTouch){try{te=new TouchEvent(type,{bubbles:true,cancelable:true,composed:true,touches:touches,targetTouches:touches,changedTouches:[t],view:window})}catch(e){te=null}}
if(!te){try{te=document.createEvent("UIEvent");te.initUIEvent(type,true,true,window,0);try{Object.defineProperty(te,"touches",{value:touches,enumerable:true});Object.defineProperty(te,"targetTouches",{value:touches,enumerable:true});Object.defineProperty(te,"changedTouches",{value:[t],enumerable:true})}catch(e2){te.touches=touches;te.targetTouches=touches;te.changedTouches=[t]}}catch(e3){return false}}
try{target.dispatchEvent(te)}catch(e){}return!!te.defaultPrevented}
function dispatchPointer(type,ev,target){try{var pe=new PointerEvent(type,{bubbles:true,cancelable:true,composed:true,pointerId:1,pointerType:"touch",isPrimary:true,clientX:ev.clientX,clientY:ev.clientY,screenX:ev.screenX,screenY:ev.screenY,button:0,buttons:type==="pointerup"?0:1,view:window});target.dispatchEvent(pe)}catch(e){}}
function isScrollableOv(ov){return ov==="auto"||ov==="scroll"||ov==="overlay"}
function findScroller(el,axis){var doc=document;while(el&&el.nodeType===1&&el!==doc.body&&el!==doc.documentElement){try{var st=window.getComputedStyle(el);var ov=axis==="y"?st.overflowY:st.overflowX;var fits=axis==="y"?el.scrollHeight>el.clientHeight+1:el.scrollWidth>el.clientWidth+1;if(isScrollableOv(ov)&&fits)return el}catch(e){}el=el.parentElement||el.parentNode}return doc.scrollingElement||doc.documentElement}
/* Walk up from the pointer target and report which axes the FIRST scrollable
   ancestor can scroll in.  Used to bias axis-lock toward the user's intent. */
function detectInnerDir(el){var res={x:false,y:false};var doc=document;while(el&&el.nodeType===1&&el!==doc.body&&el!==doc.documentElement){try{var st=window.getComputedStyle(el);var xs=isScrollableOv(st.overflowX)&&el.scrollWidth>el.clientWidth+1;var ys=isScrollableOv(st.overflowY)&&el.scrollHeight>el.clientHeight+1;if(xs||ys){res.x=xs;res.y=ys;return res}}catch(e){}el=el.parentElement||el.parentNode}return res}
function scrollAxis(el,dx,dy){if(!el)return;if(el===document.scrollingElement||el===document.documentElement||el===document.body){try{window.scrollBy(dx,dy)}catch(e){}}else{if(dx)el.scrollLeft+=dx;if(dy)el.scrollTop+=dy}}
var LOCK_THRESHOLD=10,LOCK_RATIO=1.5;
var dragging=false,tid=0,dragTarget=null,lastX=0,lastY=0,startX=0,startY=0;
var scrollerX=null,scrollerY=null,pageHandling=false,axisLock=null,innerDirX=false,innerDirY=false,suppressClick=false,suppressTimer=0;
var samples=[],rafId=0;
function cancelInertia(){if(rafId){try{cancelAnimationFrame(rafId)}catch(e){}rafId=0}}
function startInertia(){var now=performance.now();var cutoff=now-100;var sumDx=0,sumDy=0,firstT=null;for(var i=0;i<samples.length;i++){if(samples[i].t>=cutoff){if(firstT===null)firstT=samples[i].t;sumDx+=samples[i].dx;sumDy+=samples[i].dy}}var vx=0,vy=0;if(firstT!==null&&now-firstT>0){var span=now-firstT;vx=sumDx/span;vy=sumDy/span}if(axisLock==="x")vy=0;else if(axisLock==="y")vx=0;if(Math.abs(vx)<0.05&&Math.abs(vy)<0.05)return;var lastTime=now;function step(t){var dt=t-lastTime;if(dt<=0)dt=16;lastTime=t;var mx=-vx*dt,my=-vy*dt;if(axisLock==="x"){if(scrollerX)scrollAxis(scrollerX,mx,0)}else if(axisLock==="y"){if(scrollerY)scrollAxis(scrollerY,0,my)}else if(scrollerX&&scrollerY&&scrollerX===scrollerY){scrollAxis(scrollerX,mx,my)}else{if(scrollerX)scrollAxis(scrollerX,mx,0);if(scrollerY)scrollAxis(scrollerY,0,my)}var decay=Math.exp(-dt/325);vx*=decay;vy*=decay;if(Math.abs(vx)<0.02&&Math.abs(vy)<0.02){rafId=0;return}rafId=requestAnimationFrame(step)}rafId=requestAnimationFrame(step)}
window.addEventListener("click",function(ev){if(suppressClick){suppressClick=false;if(suppressTimer){clearTimeout(suppressTimer);suppressTimer=0}try{ev.stopImmediatePropagation();ev.preventDefault()}catch(e){}}},true);
window.addEventListener("mousedown",function(ev){if(ev.button!==0)return;cancelInertia();dragging=true;tid++;dragTarget=ev.target;lastX=startX=ev.clientX;lastY=startY=ev.clientY;samples.length=0;pageHandling=false;axisLock=null;scrollerX=findScroller(ev.target,"x");scrollerY=findScroller(ev.target,"y");var innerDir=detectInnerDir(ev.target);innerDirX=innerDir.x;innerDirY=innerDir.y;dispatchPointer("pointerdown",ev,ev.target);dispatchTouch("touchstart",ev,ev.target);if(!isFormField(ev.target)){try{ev.preventDefault()}catch(e){}}},true);
window.addEventListener("mousemove",function(ev){if(!dragging)return;var t=dragTarget||ev.target;var now=performance.now();var dx=ev.clientX-lastX,dy=ev.clientY-lastY;lastX=ev.clientX;lastY=ev.clientY;samples.push({t:now,dx:dx,dy:dy});if(samples.length>20)samples.shift();dispatchPointer("pointermove",ev,t);var prevented=dispatchTouch("touchmove",ev,t);if(prevented)pageHandling=true;if(!pageHandling){var absDx=Math.abs(ev.clientX-startX),absDy=Math.abs(ev.clientY-startY);if(axisLock===null){if(absDx>LOCK_THRESHOLD||absDy>LOCK_THRESHOLD){if(absDx>absDy*LOCK_RATIO)axisLock="x";else if(absDy>absDx*LOCK_RATIO)axisLock="y";else if(innerDirX&&!innerDirY)axisLock="x";else if(innerDirY&&!innerDirX)axisLock="y";else axisLock=absDx>=absDy?"x":"y";var cumDx=ev.clientX-startX,cumDy=ev.clientY-startY;if(axisLock==="x"){if(scrollerX)scrollAxis(scrollerX,-cumDx,0)}else{if(scrollerY)scrollAxis(scrollerY,0,-cumDy)}}}else if(axisLock==="x"){if(scrollerX)scrollAxis(scrollerX,-dx,0)}else{if(scrollerY)scrollAxis(scrollerY,0,-dy)}}try{ev.preventDefault()}catch(e){}},true);
window.addEventListener("mouseup",function(ev){if(ev.button!==0)return;if(!dragging)return;dragging=false;var t=dragTarget||ev.target;dragTarget=null;var moved=Math.max(Math.abs(ev.clientX-startX),Math.abs(ev.clientY-startY));if(moved>LOCK_THRESHOLD){suppressClick=true;if(suppressTimer)clearTimeout(suppressTimer);suppressTimer=setTimeout(function(){suppressClick=false;suppressTimer=0},500)}dispatchPointer("pointerup",ev,t);dispatchTouch("touchend",ev,t);if(!pageHandling&&axisLock)startInertia();scrollerX=scrollerY=null;axisLock=null},true);
window.addEventListener("mouseleave",function(ev){if(!dragging)return;dragging=false;var t=dragTarget||ev.target;dragTarget=null;dispatchPointer("pointercancel",ev,t);dispatchTouch("touchcancel",ev,t);scrollerX=scrollerY=null;axisLock=null},true);
window.addEventListener("wheel",cancelInertia,{capture:true,passive:true});
window.addEventListener("selectstart",function(ev){if(!isFormField(ev.target))try{ev.preventDefault()}catch(e){}},true);
window.addEventListener("dragstart",function(ev){try{ev.preventDefault()}catch(e){}},true);
})();`;
}
