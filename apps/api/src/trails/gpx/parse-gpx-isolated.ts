import { Worker } from 'node:worker_threads';
import { GpxError, type GpxErrorCode, type Track } from './parse-gpx.js';

// Under tests and `pnpm dev` this module is TypeScript; the built API runs dist/**/*.js.
const TS = import.meta.url.endsWith('.ts');
const WORKER = new URL(`./gpx.worker.${TS ? 'ts' : 'js'}`, import.meta.url);

export const PARSE_LIMITS = { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 };
export const PARSE_TIMEOUT_MS = 5000;

type Reply = { track: Track } | { code: GpxErrorCode };

/**
 * parseGpx in a Worker with its own heap and time caps (B1): saxes buffers a whole comment, text
 * node, CDATA, PI or attribute value, so a hostile file exhausts the worker, never the API. Out of
 * memory or over time → 400 GPX_TOO_COMPLEX; any other worker failure is a server error (500).
 * ponytail: one Worker per upload (a start of some 10 ms); the per-user upload throttle bounds the
 * rate. A pool when uploads are frequent.
 */
export function parseGpxIsolated(bytes: Uint8Array, timeoutMs = PARSE_TIMEOUT_MS): Promise<Track> {
  // A copy with its own buffer is transferred: the caller keeps `bytes` (a Buffer may share a pool).
  const copy = new Uint8Array(bytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      workerData: copy,
      transferList: [copy.buffer],
      resourceLimits: PARSE_LIMITS,
      execArgv: TS ? ['--import', '@swc-node/register/esm-register'] : [],
    });
    const timer = setTimeout(() => {
      reject(new GpxError('GPX_TOO_COMPLEX'));
      void worker.terminate();
    }, timeoutMs);
    // A promise settles once: whichever event comes first decides.
    worker.once('message', (reply: Reply) => {
      clearTimeout(timer);
      if ('track' in reply) resolve(reply.track);
      else reject(new GpxError(reply.code));
    });
    worker.once('error', (error: Error & { code?: string }) => {
      clearTimeout(timer);
      reject(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new GpxError('GPX_TOO_COMPLEX') : error);
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`GPX worker exited with code ${code} before it answered`));
    });
  });
}
