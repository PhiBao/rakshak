import { getAgentByName, routeAgentRequest } from "agents";
import type { CallAgent } from "./call-agent";
import type { GenomeAgent } from "./genome-agent";
import type { Env } from "./env";

export { CallAgent } from "./call-agent";
export { GenomeAgent } from "./genome-agent";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "rakshak", ts: Date.now() });
    }
    if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/evidence")) {
      const sessionId = url.pathname.split("/")[3] ?? "";
      if (!sessionId) return Response.json({ error: "session id required" }, { status: 400 });
      try {
        const agent = await getAgentByName<Env, CallAgent>(env.CallAgent, sessionId);
        const evidence = await agent.getEvidence();
        return Response.json(evidence);
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "evidence failed" }, { status: 500 });
      }
    }
    if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/snapshot")) {
      const sessionId = url.pathname.split("/")[3] ?? "";
      if (!sessionId) return Response.json({ error: "session id required" }, { status: 400 });
      try {
        const agent = await getAgentByName<Env, CallAgent>(env.CallAgent, sessionId);
        const snapshot = await agent.getSnapshot();
        return Response.json(snapshot);
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "snapshot failed" }, { status: 500 });
      }
    }
    if (url.pathname === "/api/genome") {
      try {
        const agent = await getAgentByName<Env, GenomeAgent>(env.GenomeAgent, "global");
        const [scripts, totals] = await Promise.all([agent.list(), agent.totals()]);
        return Response.json({ scripts, totals });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "genome failed" }, { status: 500 });
      }
    }
    const routed = await routeAgentRequest(request, env);
    if (routed) return routed;
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  }
};
