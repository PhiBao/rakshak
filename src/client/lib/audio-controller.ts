import type { FileAudioInput } from "./file-audio-input";
import type { RecordingMix } from "./recording-mix";

interface SpeechItem {
  role: "guardian" | "decoy";
  audio: string;
  format: string;
  text: string;
}

/**
 * Plays Rakshak's spoken interventions. The guardian's warning ducks the live
 * call; the decoy takes over the line (call audio pauses) until it finishes.
 */
export class SpeechController {
  #input: FileAudioInput | null = null;
  #queue: SpeechItem[] = [];
  #busy = false;
  #current: HTMLAudioElement | null = null;
  #mix: RecordingMix | null = null;

  attach(input: FileAudioInput): void {
    this.#input = input;
  }

  attachMix(mix: RecordingMix): void {
    this.#mix = mix;
  }

  enqueue(item: SpeechItem): void {
    this.#queue.push(item);
    void this.#drain();
  }

  stop(): void {
    this.#queue = [];
    this.#current?.pause();
    this.#current = null;
    this.#input?.duck(false);
    this.#input?.resume();
  }

  async #drain(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    while (this.#queue.length > 0) {
      const item = this.#queue.shift()!;
      const element = new Audio(`data:audio/${item.format};base64,${item.audio}`);
      this.#current = element;
      this.#mix?.attach(element);
      this.#input?.duck(true);
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        element.onended = finish;
        element.onerror = finish;
        element.play().catch(finish);
        const watchdogMs = Math.min(15000, Math.max(2500, item.text.length * 110));
        window.setTimeout(() => {
          if (!settled) {
            try {
              element.pause();
            } catch {
              // ignore
            }
            finish();
          }
        }, watchdogMs);
      });
      this.#input?.duck(false);
      this.#current = null;
    }
    this.#busy = false;
  }
}
