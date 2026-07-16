let audioContext: AudioContext | null = null

function getContext() {
  audioContext ??= new AudioContext()
  if (audioContext.state === 'suspended') void audioContext.resume()
  return audioContext
}

export function playPluck(midi: number, delaySeconds = 0, volume = 0.4) {
  const ctx = getContext()
  const frequency = 440 * 2 ** ((midi - 69) / 12)
  const lengthSeconds = 1.1
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * lengthSeconds), ctx.sampleRate)
  const samples = buffer.getChannelData(0)
  const period = Math.max(2, Math.round(ctx.sampleRate / frequency))
  const delayLine = new Float32Array(period)
  for (let i = 0; i < period; i++) delayLine[i] = Math.random() * 2 - 1
  let readIndex = 0
  for (let i = 0; i < samples.length; i++) {
    const nextIndex = (readIndex + 1) % period
    delayLine[readIndex] = (delayLine[readIndex] + delayLine[nextIndex]) * 0.4965
    samples[i] = delayLine[readIndex]
    readIndex = nextIndex
  }
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const gain = ctx.createGain()
  gain.gain.value = volume
  source.connect(gain)
  gain.connect(ctx.destination)
  source.start(ctx.currentTime + delaySeconds)
}
