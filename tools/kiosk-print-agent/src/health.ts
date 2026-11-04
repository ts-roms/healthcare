import { createServer, type Server } from "node:http";
import type { AgentHealth } from "./agent";

/** Where the health check listens: this machine only. The agent opens no other port and accepts no jobs. */
export const HEALTH_HOST = "127.0.0.1";

/**
 * A read-only health endpoint for the machine's own monitoring (a service manager, a local script): `GET /health` answers the
 * agent's state — never a ticket's content — and everything else is refused. It is bound to the loopback address, so it
 * cannot be reached from the network.
 */
export function startHealthServer(port: number, getHealth: () => AgentHealth): Promise<Server> {
  const server = createServer((request, response) => {
    const headers = { "content-type": "application/json", "cache-control": "no-store" };
    if (request.url === "/health" && request.method === "GET") {
      const health = getHealth();
      response.writeHead(health.status === "ok" && health.printer !== "offline" && health.printer !== "paper_out" ? 200 : 503, headers);
      response.end(JSON.stringify(health));
      return;
    }
    response.writeHead(request.url === "/health" ? 405 : 404, headers);
    response.end(JSON.stringify({ error: "not_found" }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HEALTH_HOST, () => resolve(server));
  });
}
