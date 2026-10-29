export type Waveform = { fps: 30; peaks: number[] };
// One peak per video frame. Do not normalize each clip: quiet inputs must remain
// visibly quiet. Display is source amplitude × clip gain, not mixed-output level.
export function pcmPeaks(samples: Int16Array, sampleRate: number): Waveform {
  const frames = Math.ceil((samples.length * 30) / sampleRate),
    peaks: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    let peak = 0;
    for (
      let i = Math.floor((frame * sampleRate) / 30);
      i < Math.min(samples.length, Math.floor(((frame + 1) * sampleRate) / 30));
      i++
    )
      peak = Math.max(peak, Math.abs(samples[i]) / 32768);
    peaks.push(Math.round(peak * 1000) / 1000);
  }
  return { fps: 30, peaks };
}
export function waveformBars(
  waveform: Waveform,
  offset: number,
  duration: number,
  volume: number,
  count = 160,
) {
  return Array.from({ length: Math.min(count, duration) }, (_, i) => {
    const length = Math.min(count, duration);
    let peak = 0;
    const start = offset + Math.floor((i * duration) / length),
      end =
        offset +
        Math.max(
          Math.floor((i * duration) / length) + 1,
          Math.ceil(((i + 1) * duration) / length),
        );
    for (let j = start; j < end; j++)
      peak = Math.max(peak, waveform.peaks[j] || 0);
    return Math.min(1, peak * volume);
  });
}
