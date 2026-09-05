// Adapted from talmolab/vibes/slp-viewer (BSD-3-Clause, commit d9410fa)
/**
 * Tracking-pass worker (D5): owns one sequential decoder over the whole
 * file and streams progress to the main thread. The per-frame consumer is
 * pluggable; the decode loop does not know what it computes.
 *
 * Borrowed from vibes: a worker that owns decoding and reports status by
 * message; re-implemented around `createSequentialDecoder`.
 */
import { byteSourceFromBlob } from './byte-source.js';
import { DecodeOrderError, createSequentialDecoder, type GrayFrame, type SequentialDecoder } from './decoder.js';
import { fnv1a32 } from './frame-hash.js';
import type { FrameConsumerKind, WorkerRequest, WorkerResponse } from './worker-protocol.js';

interface FrameConsumer {
  onFrame(frame: GrayFrame): void;
  finish(): { hashes?: Uint32Array; transfer: Transferable[] };
}

function createConsumer(kind: FrameConsumerKind, frameCount: number): FrameConsumer {
  switch (kind) {
    case 'hash': {
      const hashes = new Uint32Array(frameCount);
      return {
        onFrame(frame) {
          hashes[frame.presIndex] = fnv1a32(frame.gray);
        },
        finish: () => ({ hashes, transfer: [hashes.buffer] }),
      };
    }
  }
}

interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize: number };
}

function usedHeapBytes(): number | undefined {
  return (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
}

const PROGRESS_EVERY = 15;

let active: SequentialDecoder | null = null;

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

async function start(request: Extract<WorkerRequest, { type: 'start' }>): Promise<void> {
  if (active) {
    post({ type: 'error', name: 'Busy', message: 'a pass is already running' });
    return;
  }
  const { file, index } = request;
  const consumer = createConsumer(request.consumer, index.frameCount);
  const started = performance.now();
  let peakHeap = usedHeapBytes();

  const decoder = createSequentialDecoder(
    index,
    byteSourceFromBlob(file),
    (frame) => consumer.onFrame(frame),
    {
      optimizeForLatency: request.optimizeForLatency ?? false,
      progressEvery: PROGRESS_EVERY,
      onProgress: (presIndex) => {
        const elapsedS = (performance.now() - started) / 1000;
        const done = presIndex + 1;
        const fps = elapsedS > 0 ? done / elapsedS : 0;
        const heap = usedHeapBytes();
        if (heap !== undefined && (peakHeap === undefined || heap > peakHeap)) peakHeap = heap;
        post({
          type: 'progress',
          presIndex,
          fps,
          etaSeconds: fps > 0 ? (index.frameCount - done) / fps : 0,
        });
      },
    },
  );
  active = decoder;
  try {
    const result = await decoder.run();
    if (result.status === 'cancelled') {
      post({ type: 'cancelled', frameCount: result.frameCount });
      return;
    }
    const output = consumer.finish();
    const done: WorkerResponse = {
      type: 'done',
      frameCount: result.frameCount,
      elapsedMs: result.elapsedMs,
      fps: result.fps,
    };
    if (peakHeap !== undefined) done.peakHeapBytes = peakHeap;
    if (output.hashes) done.hashes = output.hashes;
    post(done, output.transfer);
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    const message: WorkerResponse = { type: 'error', name: error.name, message: error.message };
    if (error instanceof DecodeOrderError) {
      message.expectedPresIndex = error.expectedPresIndex;
      message.receivedPresIndex = error.receivedPresIndex;
    }
    post(message);
  } finally {
    active = null;
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'start') {
    void start(request);
  } else if (request.type === 'cancel') {
    active?.cancel();
  }
};
