#!/usr/bin/env node
/**
 * Captures screenshots of every surface for visual QA.
 * Usage: node scripts/screenshots.mjs [baseUrl] [outDir]
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const CHROME = process.env.CHROME_BIN ?? "/home/kiter/.local/bin/google-chrome";
const PORT = 9335;
const BASE = process.argv[2] ?? "http://localhost:5173";
const OUT = process.argv[3] ?? "/tmp/opencode/shots";
const sessionId = `shots-${Date.now().toString(36)}`;
mkdirSync(OUT, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "rakshak-shots-"));
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
    "--window-size=1440,1000",
    `${BASE}/`
  ],
  { stdio: "ignore" }
);

async function targets() {
  try {
    return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  } catch {
    return [];
  }
}

async function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let id = 0;
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
            const mid = ++id;
            pending.set(mid, (msg) => res(msg.result));
            ws.send(JSON.stringify({ id: mid, method, params }));
          }),
        close: () => ws.close()
      });
  });
}

async function main() {
  let target = null;
  for (let i = 0; i < 40 && !target; i += 1) {
    target = (await targets()).find((t) => t.type === "page");
    if (!target) await delay(400);
  }
  const { send, close } = await connect(target.webSocketDebuggerUrl);
  await send("Runtime.enable");
  await send("Page.enable");

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };

  const shoot = async (name) => {
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
    console.log(`shot: ${name}.png`);
  };

  const goto = async (path) => {
    await send("Page.navigate", { url: `${BASE}${path}` });
    await delay(2200);
  };

  const clickByText = async (text) =>
    evaluate(
      `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes(${JSON.stringify(
        text
      )})); if (!b) return false; b.click(); return true; })()`
    );

  await delay(2500);
  await shoot("01-landing");
  await goto("/genome");
  await shoot("02-genome");

  await goto(`/call/${sessionId}?speed=0.5`);
  await delay(1500);
  await shoot("03-call-ready");
  await clickByText("Play the scam call");
  console.log("demo started");

  for (let i = 0; i < 90; i += 1) {
    const peak = await evaluate(`(window.__rakshak?.peakSeverity ?? 0)`);
    const warned = await evaluate(`!!document.querySelector('[data-testid="stop-card"]')`);
    if (warned && peak >= 55) break;
    await delay(2000);
  }
  await shoot("04-call-warning");

  await goto(`/room/${sessionId}`);
  await delay(2500);
  await shoot("05-war-room");

  for (let i = 0; i < 60; i += 1) {
    const status = await evaluate(`(window.__rakshakRoom?.status ?? "unknown")`);
    if (status === "ended") break;
    await delay(2000);
  }
  await shoot("06-war-room-ended");

  await goto(`/evidence/${sessionId}`);
  await delay(3000);
  await shoot("07-evidence");

  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });
  await goto(`/call/${sessionId}`);
  await delay(1800);
  await shoot("08-call-mobile");

  close();
  chrome.kill("SIGKILL");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  chrome.kill("SIGKILL");
  process.exit(1);
});
