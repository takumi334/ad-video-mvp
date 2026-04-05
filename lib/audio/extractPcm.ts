const TARGET_SAMPLE_RATE = 16000;

/**
 * Resample Float32Array using linear interpolation.
 * @param samples - source samples
 * @param fromRate - source sample rate
 * @param toRate - target sample rate (16000)
 */
function resample(
  samples: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return samples;
  const length = Math.round((samples.length * toRate) / fromRate);
  const result = new Float32Array(length);
  const ratio = samples.length / length;
  for (let i = 0; i < length; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const t = srcIndex - i0;
    result[i] = samples[i0] * (1 - t) + samples[i1] * t;
  }
  return result;
}

/**
 * Downmix stereo to mono (average L/R).
 */
function downmixToMono(buffer: AudioBuffer): Float32Array {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  if (numChannels === 1) {
    return buffer.getChannelData(0).slice(0);
  }
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    mono[i] = (left[i] + right[i]) / 2;
  }
  return mono;
}

/**
 * Extract mono 16kHz Float32 PCM from an MP4 (or any media) URL.
 * Uses AudioContext.decodeAudioData. Stereo is downmixed; sample rate is resampled with linear interpolation.
 * @param url - URL of the media file (e.g. video.url)
 * @returns Float32Array of mono 16kHz PCM, or null on error (errors are logged to console).
 */
export async function extractPcm16kFromUrl(
  url: string
): Promise<Float32Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error("extractPcm16kFromUrl: fetch failed", res.status, url);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    return extractPcm16kFromArrayBuffer(arrayBuffer);
  } catch (e) {
    console.error("extractPcm16kFromUrl:", e);
    return null;
  }
}

/**
 * Extract mono 16kHz Float32 PCM from an ArrayBuffer (decoded from MP4/audio file).
 */
export async function extractPcm16kFromArrayBuffer(
  arrayBuffer: ArrayBuffer
): Promise<Float32Array | null> {
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const mono = downmixToMono(decoded);
    const sr = decoded.sampleRate;
    const pcm16k = resample(mono, sr, TARGET_SAMPLE_RATE);
    return pcm16k;
  } catch (e) {
    console.error("extractPcm16kFromArrayBuffer:", e);
    return null;
  } finally {
    await ctx.close();
  }
}
