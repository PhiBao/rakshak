/**
 * Captures the exact audio the page plays (call recording + guardian/decoy TTS)
 * into a single MediaRecorder track, used by the automated demo recorder.
 */
export class RecordingMix {
  #context: AudioContext;
  #destination: MediaStreamAudioDestinationNode;
  #recorder: MediaRecorder | null = null;
  #chunks: BlobPart[] = [];
  #attached = new WeakSet<HTMLMediaElement>();

  constructor() {
    this.#context = new AudioContext();
    this.#destination = this.#context.createMediaStreamDestination();
  }

  async resume(): Promise<void> {
    if (this.#context.state === "suspended") await this.#context.resume();
  }

  attach(element: HTMLMediaElement): void {
    if (this.#attached.has(element)) return;
    try {
      const source = this.#context.createMediaElementSource(element);
      source.connect(this.#context.destination);
      source.connect(this.#destination);
      this.#attached.add(element);
    } catch {
      // Element already connected elsewhere; skip routing.
    }
  }

  start(): void {
    if (this.#recorder) return;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    this.#recorder = new MediaRecorder(this.#destination.stream, { mimeType, audioBitsPerSecond: 128000 });
    this.#chunks = [];
    this.#recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.#chunks.push(event.data);
    };
    this.#recorder.start(1000);
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const recorder = this.#recorder;
      if (!recorder) {
        resolve(new Blob([], { type: "audio/webm" }));
        return;
      }
      recorder.onstop = () => {
        resolve(new Blob(this.#chunks, { type: recorder.mimeType || "audio/webm" }));
        this.#recorder = null;
      };
      recorder.stop();
    });
  }
}
