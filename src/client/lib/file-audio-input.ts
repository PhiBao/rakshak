import type { VoiceAudioInput } from "@cloudflare/voice/client";
import type { RecordingMix } from "./recording-mix";

/**
 * Streams a pre-recorded call (or any audio file) into the voice pipeline at
 * real time, using the same HTMLAudioElement for speaker playback so that what
 * the demo audience hears is exactly what the STT pipeline sees.
 */
export class FileAudioInput implements VoiceAudioInput {
  onAudioLevel: ((rms: number) => void) | null = null;
  onAudioData: ((pcm: ArrayBuffer) => void) | null = null;
  onEnded: (() => void) | null = null;
  onProgress: ((fraction: number, seconds: number) => void) | null = null;

  audio: HTMLAudioElement | null = null;
  #pcm: Int16Array | null = null;
  #timer: number | null = null;
  #sentSamples = 0;
  #sampleRate = 16000;
  #url: string;
  #speed: number;
  #disposed = false;
  #mix: RecordingMix | null;
  #startedAt = 0;
  #endedFired = false;
  #batch: { chunkSeconds: number; onChunk: (pcm: Uint8Array) => void } | null;
  #batchBuffer: Uint8Array | null = null;
  #batchFill = 0;

  constructor(url: string, options?: { speed?: number; mix?: RecordingMix; batch?: { chunkSeconds?: number; onChunk: (pcm: Uint8Array) => void } }) {
    this.#url = url;
    this.#speed = options?.speed ?? 1;
    this.#mix = options?.mix ?? null;
    this.#batch = options?.batch
      ? { chunkSeconds: options.batch.chunkSeconds ?? 5, onChunk: options.batch.onChunk }
      : null;
  }

  get duration(): number {
    return this.audio?.duration ?? 0;
  }

  async start(): Promise<void> {
    const response = await fetch(this.#url);
    if (!response.ok) throw new Error(`demo audio not found: ${this.#url}`);
    const raw = await response.arrayBuffer();

    const decodeContext = new AudioContext();
    const decoded = await decodeContext.decodeAudioData(raw.slice(0));
    const targetRate = this.#sampleRate;
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * targetRate)), targetRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    await decodeContext.close();

    const channel = rendered.getChannelData(0);
    const pcm = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channel[i] ?? 0));
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    this.#pcm = pcm;

    const audio = new Audio(this.#url);
    audio.playbackRate = this.#speed;
    audio.volume = 1;
    this.#mix?.attach(audio);
    audio.addEventListener("ended", () => {
      if (this.#disposed) return;
      this.#stopTimer();
      this.onEnded?.();
    });
    this.audio = audio;
    try {
      await Promise.race([audio.play(), new Promise((resolve) => setTimeout(resolve, 1500))]);
    } catch {
      // autoplay was blocked; fall through to the muted fallback below
    }
    if (audio.paused) {
      // Muted playback is always permitted and still advances the clock, so the
      // pipeline keeps receiving audio even when speakers are blocked.
      audio.muted = true;
      try {
        await audio.play();
      } catch {
        // give up silently; the ended handler will not fire
      }
    }

    this.#startedAt = performance.now();
    if (this.#batch && this.#pcm) {
      this.#batchBuffer = new Uint8Array(this.#batch.chunkSeconds * this.#sampleRate * 2);
      this.#batchFill = 0;
    }
    this.#timer = window.setInterval(() => this.#tick(), 40);
  }

  #tick(): void {
    const pcm = this.#pcm;
    if (!pcm || this.#disposed) return;
    // The transcription stream is driven by a virtual clock at the chosen
    // playback rate; the audio element is best-effort speaker output.
    const elapsedSeconds = (performance.now() - this.#startedAt) / 1000;
    const target = Math.min(pcm.length, Math.floor(elapsedSeconds * this.#sampleRate * this.#speed));
    while (this.#sentSamples < target) {
      const end = Math.min(this.#sentSamples + 320, pcm.length);
      if (end <= this.#sentSamples) break;
      const chunk = pcm.subarray(this.#sentSamples, end);
      let sum = 0;
      for (let i = 0; i < chunk.length; i += 1) {
        const sample = (chunk[i] ?? 0) / 32768;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / Math.max(1, chunk.length));
      this.onAudioLevel?.(rms);
      this.onAudioData?.(chunk.slice().buffer);
      this.#appendToBatch(chunk);
      this.#sentSamples = end;
    }
    this.onProgress?.(this.#sentSamples / pcm.length, this.#sentSamples / this.#sampleRate);
    if (this.#sentSamples >= pcm.length && !this.#endedFired) {
      this.#endedFired = true;
      this.#flushBatch();
      this.#stopTimer();
      this.onEnded?.();
    }
  }

  #appendToBatch(chunk: Int16Array): void {
    if (!this.#batch || !this.#batchBuffer) return;
    const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let offset = 0;
    while (offset < bytes.length) {
      const room = this.#batchBuffer.length - this.#batchFill;
      const take = Math.min(room, bytes.length - offset);
      this.#batchBuffer.set(bytes.subarray(offset, offset + take), this.#batchFill);
      this.#batchFill += take;
      offset += take;
      if (this.#batchFill >= this.#batchBuffer.length) {
        this.#batch.onChunk(this.#batchBuffer.slice());
        // Keep a short tail so numbers spoken across a boundary survive.
        const overlapBytes = Math.min(this.#batchBuffer.length, this.#sampleRate * 2 * 5);
        this.#batchBuffer.copyWithin(0, this.#batchBuffer.length - overlapBytes);
        this.#batchFill = overlapBytes;
      }
    }
  }

  #flushBatch(): void {
    if (!this.#batch || !this.#batchBuffer || this.#batchFill === 0) return;
    const partial = this.#batchBuffer.slice(0, this.#batchFill);
    this.#batchFill = 0;
    if (partial.length >= this.#sampleRate) this.#batch.onChunk(partial);
  }

  pause(): void {
    this.audio?.pause();
  }

  resume(): void {
    if (!this.audio) return;
    const attempt = (retries: number) => {
      this.audio
        ?.play()
        .catch(() => {
          if (retries > 0) window.setTimeout(() => attempt(retries - 1), 250);
        });
    };
    attempt(2);
  }

  duck(on: boolean): void {
    if (!this.audio) return;
    this.audio.volume = on ? 0.08 : 1;
  }

  #stopTimer(): void {
    if (this.#timer !== null) {
      window.clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  stop(): void {
    this.#stopTimer();
    this.#disposed = true;
    this.audio?.pause();
  }
}
