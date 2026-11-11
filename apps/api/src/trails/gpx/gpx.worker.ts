// The worker side of parseGpxIsolated: one parse per worker, the result or the error code back.
import { parentPort, workerData } from 'node:worker_threads';
import { GpxError, parseGpx } from './parse-gpx.js';

try {
  parentPort!.postMessage({ track: parseGpx(workerData as Uint8Array) });
} catch (error) {
  if (!(error instanceof GpxError)) throw error;
  parentPort!.postMessage({ code: error.code });
}
