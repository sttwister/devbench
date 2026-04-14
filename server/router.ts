import type http from "http";

type Params = Record<string, string>;

type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Params
) => void | Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

/**
 * Lightweight router for the API layer.
 *
 * Supports:
 *   router.get("/api/projects", handler)
 *   router.post("/api/projects/:id/sessions", handler)
 *   router.delete("/api/sessions/:id", handler)
 *
 * Path parameters (`:id`) are extracted and passed as `params.id`.
 * Query strings are stripped before matching.
 */
export class Router {
  private routes: Route[] = [];

  private add(method: string, path: string, handler: RouteHandler) {
    const paramNames: string[] = [];
    // Convert "/api/projects/:id/sessions" → /^\/api\/projects\/(\d+)\/sessions$/
    const patternStr = path.replace(/:(\w+)/g, (_match, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    this.routes.push({
      method,
      pattern: new RegExp(`^${patternStr}$`),
      paramNames,
      handler,
    });
  }

  get(path: string, handler: RouteHandler) { this.add("GET", path, handler); }
  post(path: string, handler: RouteHandler) { this.add("POST", path, handler); }
  put(path: string, handler: RouteHandler) { this.add("PUT", path, handler); }
  patch(path: string, handler: RouteHandler) { this.add("PATCH", path, handler); }
  delete(path: string, handler: RouteHandler) { this.add("DELETE", path, handler); }

  /**
   * Try to match and handle a request.
   * Returns true if a route matched, false otherwise.
   */
  handle(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const method = req.method!;
    const urlPath = (req.url ?? "/").split("?")[0];

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = urlPath.match(route.pattern);
      if (!match) continue;

      const params: Params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });

      const result = route.handler(req, res, params);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err: Error) => {
          console.error(`[router] Unhandled error in ${method} ${urlPath}:`, err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message || "Internal server error" }));
          }
        });
      }
      return true;
    }
    return false;
  }
}
