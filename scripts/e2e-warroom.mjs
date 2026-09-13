#!/usr/bin/env node
/**
 * End-to-end war room test: runs the demo in one tab, watches the family war
 * room in another, triggers guardian actions, and verifies the recovery pack.
 *
 * Usage: node scripts/e2e-warroom.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const CHROME = process.env.CHROME_BIN ?? "/home/kiter/.local/bin/google-chrome";
const PORT = 9334;
const BASE = process.argv[2] ?? "http://localhost:5173";
const sessionId = `e2e-room-${Date.now().toString(36)}`;

const profile = mkdtempSync(join(tmpdir(), "rakshak-room-"));
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
    `${BASE}/call/${sessionId}?speed=0.5`
  ],
  { stdio: "ignore" }
);

async function listTargets() {
  try {
    return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  } catch {
    return [];
  }
}

async function newTarget(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  return await res.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 0;
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    };
    ws.onerror = reject;
    ws.onopen = () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res) => {
            const id = ++nextId;
            pending.set(id, (msg) => res(msg.result));
            ws.send(JSON.stringify({ id, method, params }));
          }),
        close: () => ws.close()
      });
  });
}

async function attach(target) {
  const { send, close } = await connect(target.webSocketDebuggerUrl);
  await send("Runtime.enable");
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  return { evaluate, close };
}

async function waitForTarget(predicate, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const targets = await listTargets();
    const match = targets.find(predicate);
    if (match) return match;
    await delay(400);
  }
  throw new Error("target not found");
}

async function main() {
  const callTarget = await waitForTarget((t) => t.type === "page" && t.url.includes(`/call/${sessionId}`));
  const call = await attach(callTarget);
  await call.evaluate(`!!document.querySelector('h1')`);

  const roomTargetInfo = await newTarget(`${BASE}/room/${sessionId}`);
  const roomTarget = await waitForTarget((t) => t.id === roomTargetInfo.id || (t.type === "page" && t.url.includes(`/room/${sessionId}`)));
  const room = await attach(roomTarget);

  for (let i = 0; i < 40; i += 1) {
    const ready = await call.evaluate(
      `!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Play the scam call'))`
    );
    if (ready) break;
    await delay(400);
  }
  await call.evaluate(
    `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Play the scam call')); b.click(); })()`
  );
  console.log(`session: ${sessionId}, demo started`);

  const started = Date.now();
  let roomState = null;
  let decoyClicked = false;
  let warnClicked = false;
  let ended = false;

  while (Date.now() - started < 170000) {
    roomState = await room.evaluate(`window.__rakshakRoom ?? null`);
    const callState = await call.evaluate(`window.__rakshak ?? null`);
    if (roomState && !decoyClicked && roomState.peakSeverity >= 55) {
      const clicked = await room.evaluate(
        `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Engage counter-agent')); if (!b) return false; b.click(); return true; })()`
      );
      console.log(`[room] engage counter-agent clicked: ${clicked}`);
      decoyClicked = true;
    }
    if (roomState && !warnClicked && roomState.peakSeverity >= 60) {
      const clicked = await room.evaluate(
        `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Send guardian warning')); if (!b) return false; b.click(); return true; })()`
      );
      console.log(`[room] send warning clicked: ${clicked}`);
      warnClicked = true;
    }
    if (callState?.status === "ended" && !ended) {
      ended = true;
      console.log("[call] session ended");
      break;
    }
    await delay(2500);
  }

  console.log("\n===== ROOM STATE =====");
  console.log(
    JSON.stringify(
      {
        status: roomState?.status,
        peak: roomState ? Math.round(roomState.peakSeverity) : 0,
        family: roomState?.family,
        utterances: roomState?.utterances?.length ?? 0,
        riskEvents: roomState?.riskEvents?.length ?? 0,
        alerts: (roomState?.alerts ?? []).map((a) => a.message),
        interventions: (roomState?.interventions ?? []).map((i) => `${i.kind}:${i.triggeredBy}`),
        identifiers: (roomState?.identifiers ?? []).map((i) => `${i.type}:${i.value}`),
        decoyActive: roomState?.decoyActive
      },
      null,
      2
    )
  );

  const evidenceTargetInfo = await newTarget(`${BASE}/evidence/${sessionId}`);
  await waitForTarget((t) => t.id === evidenceTargetInfo.id || (t.type === "page" && t.url.includes(`/evidence/${sessionId}`)));
  await delay(3500);
  const evidenceTarget2 = await waitForTarget((t) => t.type === "page" && t.url.includes(`/evidence/${sessionId}`));
  const evidence = await attach(evidenceTarget2);
  const evidenceText = await evidence.evaluate(`document.body.innerText`);
  console.log("\n===== EVIDENCE PAGE =====");
  console.log(`has complaint draft: ${evidenceText.includes("COMPLAINT DRAFT") || evidenceText.toLowerCase().includes("complaint draft")}`);
  console.log(`has golden hour: ${/time since detection/i.test(evidenceText)}`);
  console.log(`has 1930: ${evidenceText.includes("1930")}`);
  console.log(`identifiers shown: ${/verifycell|x{3,}|account/i.test(evidenceText)}`);

  call.close();
  room.close();
  evidence.close();
  chrome.kill("SIGKILL");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  chrome.kill("SIGKILL");
  process.exit(1);
});
