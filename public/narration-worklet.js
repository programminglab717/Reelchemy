/* Bounded PCM capture. No microphone access until the user starts recording. */
class NarrationCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.limit = options.processorOptions.maxFrames;
    this.frames = 0;
    this.buffer = new Float32Array(4096);
    this.used = 0;
    this.done = false;
    this.port.onmessage = (event) => {
      if (event.data === "stop") this.finish();
    };
  }
  flush() {
    if (!this.used) return;
    const chunk = this.buffer.slice(0, this.used);
    this.port.postMessage({ type: "samples", chunk }, [chunk.buffer]);
    this.used = 0;
  }
  finish() {
    if (this.done) return;
    this.flush();
    this.done = true;
    this.port.postMessage({ type: "done" });
  }
  process(inputs) {
    if (this.done) return false;
    const input = inputs[0]?.[0];
    if (input)
      for (const sample of input) {
        if (this.frames >= this.limit) {
          this.finish();
          return false;
        }
        this.buffer[this.used++] = sample;
        this.frames++;
        if (this.used === this.buffer.length) this.flush();
      }
    return true;
  }
}
registerProcessor("narration-capture", NarrationCapture);
