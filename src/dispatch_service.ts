import { createServer, type ServerResponse } from "node:http";
import { infrai, InfraiError } from "./infrai_client.js";
import { WorkOrderRequest, buildDispatchView } from "./work_order.js";
import { z } from "zod";

export const FLAG_KEY = process.env.FLAG_KEY ?? "field-service-work-orders";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Buffer>): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "POST" && url.pathname === "/internal/apply-rollout") {
    const input = z.coerce.number().int().min(0).max(100).safeParse(url.searchParams.get("percentage"));
    const expectedToken = process.env.ROLLOUT_HOOK_TOKEN;
    if (!expectedToken || url.searchParams.get("token") !== expectedToken) {
      send(response, 401, { error: "unauthorized" });
      return;
    }
    if (!input.success) {
      send(response, 400, { error: "invalid_percentage" });
      return;
    }
    if (process.env.ROLLOUT_PAUSED === "true" && input.data > 0) {
      send(response, 200, { percentage: input.data, applied: false, paused: true });
      return;
    }
    try {
      await infrai.flags.rollout(
        FLAG_KEY,
        input.data,
        `${FLAG_KEY}:scheduled-rollout:${input.data}`,
      );
      send(response, 200, { percentage: input.data, applied: true });
    } catch (error) {
      if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
        send(response, error.status, { error: error.code, message: error.message });
        return;
      }
      send(response, 502, { error: "upstream_request_failed" });
    }
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/work-orders/dispatch-view") {
    send(response, 404, { error: "route_not_found" });
    return;
  }

  try {
    const parsed = WorkOrderRequest.safeParse(await readJson(request));
    if (!parsed.success) {
      send(response, 400, { error: "invalid_work_order", issues: parsed.error.issues });
      return;
    }
    const enabled = await infrai.flags.is_enabled(FLAG_KEY);
    send(response, 200, buildDispatchView(parsed.data, enabled));
  } catch (error) {
    if (error instanceof SyntaxError) {
      send(response, 400, { error: "invalid_json" });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      send(response, error.status, { error: error.code, message: error.message });
      return;
    }
    send(response, 502, { error: "upstream_request_failed" });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`Dispatch service listening on http://localhost:${port}`));
}
