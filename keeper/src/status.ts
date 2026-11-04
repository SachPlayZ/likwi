// GET /health and GET /status, with CORS so the web app can read them (heartbeat badge fallback).
import { createServer, type Server } from "node:http";
import type { Keeper } from "./loop";
import { jsonReplacer, type Logger } from "./log";

export function startStatusServer(keeper: Keeper, port: number, log: Logger): Server {
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const path = (req.url ?? "/").split("?")[0];
    const body = req.method === "GET" && path === "/health" ? keeper.health() : req.method === "GET" && path === "/status" ? keeper.status() : null;
    if (!body) {
      res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body, jsonReplacer));
  });
  server.listen(port, () => log("info", "status server listening", { port }));
  return server;
}
