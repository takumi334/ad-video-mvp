import * as ort from "onnxruntime-web";

const MODEL_PATH = "/models/silero_vad_16k_op15.onnx";
const SAMPLE_RATE = 16000;
const FRAME_SIZE = 512;
// Official snakers4 Python uses 64+512=576; some ONNX exports use 512 only. Use 0 if model input is (1, 512).
const CONTEXT_SIZE = 64;
const DEFAULT_SPEECH_THRESHOLD = 0.45;
const DEFAULT_MIN_SPEECH_SEC = 0.08;
const DEFAULT_MIN_SILENCE_SEC = 0.12;
const DEFAULT_PAD_SEC = 0.03;

export type VoiceSegment = { startSec: number; endSec: number };

export type VadParams = {
  speechThreshold?: number;
  minSpeechSec?: number;
  minSilenceSec?: number;
  padSec?: number;
};

type FrameResult = { prob: number; state: Float32Array; context: Float32Array };

let session: ort.InferenceSession | null = null;

async function getSession(): Promise<ort.InferenceSession> {
  if (session) return session;
  if (typeof window === "undefined") {
    throw new Error("Silero VAD must run in the browser (onnxruntime-web).");
  }
  ort.env.wasm.wasmPaths = "/onnxruntime/";
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;

  const createWithSimd = (simd: boolean) =>
    ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });

  try {
    ort.env.wasm.simd = true;
    session = await createWithSimd(true);
  } catch {
    ort.env.wasm.simd = false;
    session = await createWithSimd(false);
  }
  return session;
}

/**
 * Run one frame through Silero VAD with state.
 * Input to model: (1, context_size + frame_size). sr is int64 scalar 16000.
 */
async function runFrame(
  sess: ort.InferenceSession,
  chunk: Float32Array,
  state: Float32Array,
  context: Float32Array
): Promise<FrameResult> {
  const inputSize = CONTEXT_SIZE + FRAME_SIZE;
  const input = new Float32Array(inputSize);
  if (CONTEXT_SIZE > 0) {
    input.set(context, 0);
    input.set(chunk, CONTEXT_SIZE);
  } else {
    input.set(chunk, 0);
  }
  const contextNext = new Float32Array(CONTEXT_SIZE);
  if (CONTEXT_SIZE > 0) {
    contextNext.set(input.subarray(FRAME_SIZE, inputSize), 0);
  }

  const inputTensor = new ort.Tensor("float32", input, [1, inputSize]);
  const stateTensor = new ort.Tensor("float32", state, [2, 1, 128]);
  const srTensor = new ort.Tensor("int64", new BigInt64Array([BigInt(SAMPLE_RATE)]), []);

  const feeds: Record<string, ort.Tensor> = {
    input: inputTensor,
    state: stateTensor,
    sr: srTensor,
  };
  const results = await sess.run(feeds);
  const outNames = sess.outputNames;
  const out = results[outNames[0]] as ort.Tensor;
  const newState = results[outNames[1]] as ort.Tensor;
  const prob = (out.data as Float32Array)[0];
  const stateData = newState.data as Float32Array;
  const stateCopy: Float32Array = new Float32Array(stateData.length);
  stateCopy.set(stateData);
  const contextCopy: Float32Array = new Float32Array(contextNext.length);
  contextCopy.set(contextNext);
  return { prob, state: stateCopy, context: contextCopy };
}

/**
 * Detect voice segments from 16kHz mono Float32 PCM using Silero VAD (stateful).
 * Returns segments in seconds: { startSec, endSec }[].
 */
export async function detectVoiceSegments(
  pcm16k: Float32Array,
  params?: VadParams
): Promise<VoiceSegment[]> {
  const speechThreshold = params?.speechThreshold ?? DEFAULT_SPEECH_THRESHOLD;
  const minSpeechSec = params?.minSpeechSec ?? DEFAULT_MIN_SPEECH_SEC;
  const minSilenceSec = params?.minSilenceSec ?? DEFAULT_MIN_SILENCE_SEC;
  const padSec = params?.padSec ?? DEFAULT_PAD_SEC;
  const negThreshold = Math.max(speechThreshold - 0.15, 0.01);

  const sess = await getSession();
  const numSamples = pcm16k.length;
  const minSpeechSamples = SAMPLE_RATE * minSpeechSec;
  const minSilenceSamples = SAMPLE_RATE * minSilenceSec;
  const padSamples = SAMPLE_RATE * padSec;

  const speechProbs: number[] = [];
  let state = new Float32Array(2 * 1 * 128);
  let context = new Float32Array(CONTEXT_SIZE);

  for (let i = 0; i < numSamples; i += FRAME_SIZE) {
    const chunk = pcm16k.subarray(i, i + FRAME_SIZE);
    if (chunk.length < FRAME_SIZE) {
      const padded = new Float32Array(FRAME_SIZE);
      padded.set(chunk);
      const r = await runFrame(sess, padded, state, context);
      speechProbs.push(r.prob);
      state = new Float32Array(r.state);
      context = new Float32Array(r.context);
    } else {
      const r = await runFrame(sess, chunk as Float32Array, state, context);
      speechProbs.push(r.prob);
      state = new Float32Array(r.state);
      context = new Float32Array(r.context);
    }
  }

  const speeches: { start: number; end: number }[] = [];
  let triggered = false;
  let currentSpeech: { start: number; end: number } | null = null;
  let tempEnd = 0;

  for (let i = 0; i < speechProbs.length; i++) {
    const curSample = FRAME_SIZE * i;
    const speechProb = speechProbs[i];

    if (speechProb >= speechThreshold && !triggered) {
      triggered = true;
      currentSpeech = { start: curSample, end: curSample };
      continue;
    }

    if (speechProb < negThreshold && triggered && currentSpeech) {
      if (tempEnd === 0) tempEnd = curSample;
      const silDur = curSample - tempEnd;
      if (silDur >= minSilenceSamples) {
        currentSpeech.end = tempEnd;
        if (currentSpeech.end - currentSpeech.start >= minSpeechSamples) {
          speeches.push({ ...currentSpeech });
        }
        currentSpeech = null;
        triggered = false;
        tempEnd = 0;
      }
      continue;
    }

    if (speechProb >= speechThreshold && triggered) {
      tempEnd = 0;
    }
  }

  if (currentSpeech && numSamples - currentSpeech.start >= minSpeechSamples) {
    currentSpeech.end = numSamples;
    speeches.push({ ...currentSpeech });
  }

  const pad = (n: number) => Math.max(0, Math.min(numSamples, n));
  for (let i = 0; i < speeches.length; i++) {
    const s = speeches[i];
    if (i === 0) {
      s.start = pad(s.start - padSamples);
    }
    if (i < speeches.length - 1) {
      const next = speeches[i + 1];
      const silenceDur = next.start - s.end;
      if (silenceDur < 2 * padSamples) {
        const half = Math.floor(silenceDur / 2);
        s.end = pad(s.end + half);
        next.start = pad(next.start - half);
      } else {
        s.end = pad(s.end + padSamples);
        next.start = pad(next.start - padSamples);
      }
    } else {
      s.end = pad(s.end + padSamples);
    }
  }

  return speeches.map((s) => ({
    startSec: s.start / SAMPLE_RATE,
    endSec: s.end / SAMPLE_RATE,
  }));
}
