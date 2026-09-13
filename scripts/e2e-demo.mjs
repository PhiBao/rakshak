#!/usr/bin/env node
/**
 * End-to-end smoke test: drives the parent shield in headless Chrome, plays the
 * bundled scam call through the real pipeline, and reports classifier output.
 *
 * Usage: node scripts/e2e-demo.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const CHROME = process.env.CHROME_BIN ?? "/home/kiter/.local/bin/google-chrome";
const PORT = 9333;
const BASE = process.argv[2] ?? "http://localhost:5173";
const sessionId = `e2e-${Date.now().toString(36)}`;
const url = `${BASE}/call/${sessionId}`;

const profile = mkdtempSync(join(tmpdir(), "rakshak-chrome-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-sandbox",
    "--disable-gpu",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
    "--no-first-run",
    "--disable-dev-shm-usage",
    url
  ],
  { stdio: "ignore" }
);

async function listTargets() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    return await res.json();
  } catch {
    return [];
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 0;
    const events = [];
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        events.push(`console.error: ${message.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
      } else if (message.method === "Runtime.exceptionThrown") {
        events.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
      }
    };
    ws.onerror = reject;
    ws.onopen = () => {
      const send = (method, params = {}) =>
        new Promise((res) => {
          const id = ++nextId;
          pending.set(id, (msg) => res(msg.result));
          ws.send(JSON.stringify({ id, method, params }));
        });
      resolve({ send, events, close: () => ws.close() });
    };
  });
}

async function main() {
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    const targets = await listTargets();
    target = targets.find((t) => t.type === "page" && t.url.includes("/call/"));
    if (!target) await delay(500);
  }
  if (!target) throw new Error("Chrome page target not found");

  const { send, events, close } = await connect(target.webSocketDebuggerUrl);
  await send("Runtime.enable");
  await send("Page.enable");

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };

  console.log(`session: ${sessionId}`);
  for (let i = 0; i < 60; i += 1) {
    const ready = await evaluate(
      `!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Play the scam call'))`
    );
    if (ready) break;
    await delay(500);
  }

  const clicked = await evaluate(
    `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Play the scam call')); if (!b) return false; b.click(); return true; })()`
  );
  console.log(`clicked start: ${clicked}`);

  const started = Date.now();
  let last = "";
  let finalState = null;
  while (Date.now() - started < 170000) {
    const state = await evaluate(`(() => {
      const s = window.__rakshak;
      if (!s) return null;
      const risks = s.riskEvents || [];
      return {
        status: s.status,
        peak: Math.round(s.peakSeverity || 0),
        family: s.family || null,
        utterances: (s.utterances || []).length,
        stages: risks.map(r => r.family + "/" + r.stageId + "@" + Math.round(r.severity)),
        interventions: (s.interventions || []).length,
        identifiers: (s.identifiers || []).map(i => i.type + ":" + i.value),
        decoy: !!s.decoyActive,
        fallbacks: (s.pipeline || []).filter(l => l.status === "fallback").length,
        errors: (s.pipeline || []).filter(l => l.status === "error").length,
        lastModel: risks.length ? risks[risks.length - 1].model : null,
        lastLatency: risks.length ? risks[risks.length - 1].latencyMs : null,
        pipelineDetail: (s.pipeline || []).slice(-6).map(l => l.kind + "/" + l.status + "/" + (l.detail || ""))
      };
    })()`);
    if (state) {
      const summary = JSON.stringify(state);
      if (summary !== last) {
        console.log(`[${new Date().toISOString().slice(11, 19)}] ${summary}`);
        last = summary;
        finalState = state;
      }
      if (state.status === "ended") break;
    }
    await delay(2500);
  }

  const stopCard = await evaluate(`!!document.querySelector('[data-testid="stop-card"]')`).catch(() => false);
  const evidenceReady = await evaluate(
    `fetch('/api/health').then(() => true).catch(() => false)`
  ).catch(() => false);
  const steps = await evaluate(`window.__rakshakSteps ?? []`).catch(() => []);
  const startError = await evaluate(`window.__rakshakStartError ?? null`).catch(() => null);
  const uiError = await evaluate(
    `document.body.innerText.match(/error[^\\n]*/i)?.[0] ?? null`
  ).catch(() => null);

  console.log("\n===== E2E SUMMARY =====");
  console.log(`start steps: ${JSON.stringify(steps)}`);
  console.log(`start error: ${startError}`);
  console.log(`ui error text: ${uiError}`);
  console.log(`stop-card shown: ${stopCard}`);
  console.log(`health reachable: ${evidenceReady}`);
  console.log(`final state: ${JSON.stringify(finalState, null, 2)}`);
  if (events.length) {
    console.log("browser errors:");
    for (const event of events.slice(0, 12)) console.log(` - ${event}`);
  } else {
    console.log("browser errors: none");
  }

  close();
  chrome.kill("SIGKILL");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  chrome.kill("SIGKILL");
  process.exit(1);
});
