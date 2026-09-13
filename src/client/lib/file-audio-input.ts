import type { VoiceAudioInput } from "@cloudflare/voice/client";

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

  constructor(url: string, options?: { speed?: number }) {
    this.#url = url;
    this.#speed = options?.speed ?? 1;
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
    audio.addEventListener("ended", () => {
      if (this.#disposed) return;
      this.#stopTimer();
      this.onEnded?.();
    });
    this.audio = audio;
    await audio.play();

    this.#timer = window.setInterval(() => this.#tick(), 40);
  }

  #tick(): void {
    const pcm = this.#pcm;
    const audio = this.audio;
    if (!pcm || !audio || this.#disposed) return;
    if (audio.paused) return;
    const played = Math.floor(audio.currentTime * this.#sampleRate);
    while (this.#sentSamples < played) {
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
      this.#sentSamples = end;
    }
    if (audio.duration > 0) this.onProgress?.(audio.currentTime / audio.duration, audio.currentTime);
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
