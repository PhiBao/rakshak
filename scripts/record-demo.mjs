#!/usr/bin/env node
/**
 * Automated demo recorder (two-instance design).
 *
 * Chrome A runs the live pipeline on the parent shield with no CDP screenshot
 * traffic. Chrome B watches the same session in the family war room and is the
 * source of video frames (screenshot capture starves media timers, so it must
 * never touch the pipeline tab). A few stills from A are spliced in at key
 * moments (stop card, recovery). Audio is rebuilt offline from the snapshot.
 *
 * Usage: node scripts/record-demo.mjs [baseUrl] [outFile]
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const CHROME = process.env.CHROME_BIN ?? "/home/kiter/.local/bin/google-chrome";
const PORT_A = 9500 + Math.floor(Math.random() * 200);
const PORT_B = 9800 + Math.floor(Math.random() * 150);
const BASE = process.argv[2] ?? "http://localhost:5173";
const OUT = process.argv[3] ?? "/home/kiter/buuniex/docs/submission/rakshak-demo.mp4";
const SPEED = process.env.DEMO_SPEED ?? "1";
const sessionId = `video-${Date.now().toString(36)}`;
const workDir = mkdtempSync(join(tmpdir(), "rakshak-video-"));
const framesDir = join(workDir, "frames");
mkdirSync(framesDir, { recursive: true });

console.log(`session: ${sessionId}`);
console.log(`workdir: ${workDir}`);

const commonFlags = [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--autoplay-policy=no-user-gesture-required",
  "--mute-audio",
  "--no-first-run",
  "--disable-dev-shm-usage",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--window-size=1600,1000"
];

const chromeA = spawn(
  CHROME,
  [...commonFlags, `--remote-debugging-port=${PORT_A}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "rakshak-a-"))}`, `${BASE}/call/${sessionId}?speed=${SPEED}`],
  { stdio: "ignore" }
);
const chromeB = spawn(
  CHROME,
  [...commonFlags, `--remote-debugging-port=${PORT_B}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "rakshak-b-"))}`, `${BASE}/room/${sessionId}`],
  { stdio: "ignore" }
);

async function findTarget(port, includes) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const match = list.find((t) => t.type === "page" && t.url.includes(includes));
      if (match) return match;
    } catch {
      // retry
    }
    await delay(400);
  }
  return null;
}

function connect(wsUrl) {
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

async function attach(port, includes) {
  const target = await findTarget(port, includes);
  if (!target) throw new Error(`target not found on ${port}`);
  const { send, close } = await connect(target.webSocketDebuggerUrl);
  await send("Runtime.enable");
  await send("Page.enable");
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  return { send, evaluate, close };
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function main() {
  const a = await attach(PORT_A, `/call/${sessionId}`);
  const b = await attach(PORT_B, `/room/${sessionId}`);

  // Make sure the viewing tab actually rendered before we record it.
  for (let i = 0; i < 30; i += 1) {
    const rendered = await b
      .evaluate(`document.body && document.body.innerText.includes("Family War Room")`)
      .catch(() => false);
    if (rendered) break;
    await b.send("Page.navigate", { url: `${BASE}/room/${sessionId}` }).catch(() => undefined);
    await delay(1500);
  }
  const roomReady = await b
    .evaluate(`document.body && document.body.innerText.includes("Family War Room")`)
    .catch(() => false);
  console.log(`war room rendered: ${roomReady}`);

  let frameIndex = 0;
  let lastFrameTime = null;
  let firstFrameWallMs = null;
  const timeline = [];
  const captures = [];

  const shoot = async (instance, label) => {
    try {
      const result = await Promise.race([
        instance.send("Page.captureScreenshot", { format: "jpeg", quality: 85, captureBeyondViewport: false }),
        delay(4000).then(() => null)
      ]);
      if (!result?.data) return;
      frameIndex += 1;
      const name = `frame-${String(frameIndex).padStart(6, "0")}.jpg`;
      writeFileSync(join(framesDir, name), Buffer.from(result.data, "base64"));
      const now = Date.now();
      if (firstFrameWallMs === null) firstFrameWallMs = now;
      timeline.push(lastFrameTime === null ? 0.3 : Math.max(0.06, (now - lastFrameTime) / 1000));
      lastFrameTime = now;
      captures.push({ name, wall: now, label });
    } catch {
      // ignore
    }
  };

  let capturing = true;
  const captureLoop = (async () => {
    while (capturing) {
      await shoot(b, "war-room");
      await delay(320);
    }
  })();

  // Parent shield stills at key moments (few and far between to avoid starving A).
  for (let i = 0; i < 50; i += 1) {
    const ready = await a.evaluate(
      `!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Play the scam call'))`
    );
    if (ready) break;
    await delay(400);
  }
  await shoot(a, "parent-idle");
  await delay(2500);

  console.log("starting demo…");
  const clickTime = Date.now();
  const clicked = await a.evaluate(
    `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Play the scam call')); if (!b) return false; b.click(); return true; })()`
  );
  console.log(`clicked: ${clicked}`);

  let warningCaptured = false;
  let decoyCaptured = false;
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const state = await a.evaluate(`window.__rakshak ?? null`);
    if (!warningCaptured && state && state.peakSeverity >= 55) {
      await shoot(a, "parent-warning");
      warningCaptured = true;
      await delay(3000);
    }
    if (!decoyCaptured && state && state.decoyActive) {
      await shoot(a, "parent-decoy");
      decoyCaptured = true;
      await delay(3000);
    }
    if (state?.status === "ended") break;
    await delay(1500);
  }

  await shoot(a, "parent-recovered");
  await delay(2500);
  const snapshot = await a.evaluate(`window.__rakshak ?? null`);
  if (!snapshot) throw new Error("no snapshot");
  const snapshotPath = join(workDir, "snapshot.json");
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  console.log("touring recovery surfaces in the viewing tab…");
  const tourMarks = {};
  const tour = async (path, holdSeconds, waitFor, markKey) => {
    tourMarks[markKey] = Date.now();
    await b.send("Page.navigate", { url: `${BASE}${path}` });
    if (waitFor) {
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const found = await b
          .evaluate(`document.body.innerText.includes(${JSON.stringify(waitFor)})`)
          .catch(() => false);
        if (found) break;
        await delay(800);
      }
    } else {
      await delay(1500);
    }
    await delay(holdSeconds * 1000);
  };
  await tour(`/evidence/${sessionId}`, 6, "Complaint draft", "evidence");
  await tour("/genome", 5, "Scam Genome", "genome");

  capturing = false;
  await captureLoop;
  await delay(400);

  writeFileSync(join(workDir, "meta.json"), JSON.stringify({ sessionId, clickTime, firstFrameWallMs, timeline, tourMarks }));
  console.log("building narrated video…");
  await new Promise((resolve, reject) => {
    const child = spawn("node", [join(process.cwd(), "scripts", "build-demo-video.mjs"), workDir, OUT], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`video build exited ${code}`))));
  });

  a.close();
  b.close();
  chromeA.kill("SIGKILL");
  chromeB.kill("SIGKILL");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  chromeA.kill("SIGKILL");
  chromeB.kill("SIGKILL");
  process.exit(1);
});
