// The last `seconds` of microphone audio at ~16 kHz, kept on the audio thread, so a clip can be
// cut around a sound after it has happened (tracker.js). Posts the buffer, oldest first, on request.
class Ring extends AudioWorkletProcessor {
  constructor({ processorOptions: o }) {
    super()
    this.step = Math.max(1, Math.round(sampleRate / o.rate))
    this.rate = sampleRate / this.step
    this.buf = new Float32Array(Math.round(this.rate * o.seconds))
    this.i = 0; this.acc = 0; this.k = 0
    this.port.onmessage = () => {
      const n = this.buf.length, out = new Float32Array(n)
      out.set(this.buf.subarray(this.i)); out.set(this.buf.subarray(0, this.i), n - this.i)
      this.port.postMessage({ pcm: out, at: currentTime, rate: this.rate }, [out.buffer])
    }
  }
  process(inputs) {
    const ch = inputs[0][0]
    if (!ch) return true
    for (let j = 0; j < ch.length; j++) {
      this.acc += ch[j]
      if (++this.k === this.step) {
        this.buf[this.i] = this.acc / this.step
        this.i = (this.i + 1) % this.buf.length
        this.acc = 0; this.k = 0
      }
    }
    return true
  }
}
registerProcessor('ring', Ring)
