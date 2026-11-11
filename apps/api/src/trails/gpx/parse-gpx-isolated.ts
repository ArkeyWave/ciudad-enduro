import { Worker } from 'node:worker_threads';
import { ServiceUnavailableException } from '@nestjs/common';
import { GpxError, type GpxErrorCode, type Track } from './parse-gpx.js';

// Under tests and `pnpm dev` this module is TypeScript; the built API runs dist/**/*.js. The
// TypeScript worker loads through tsx (esbuild in a child process): a native loader such as
// @swc-node/register crashed the process (SIGSEGV) when a worker thread exited.
const TS = import.meta.url.endsWith('.ts');
const WORKER = new URL(`./gpx.worker.${TS ? 'ts' : 'js'}`, import.meta.url);

export const PARSE_LIMITS = { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 };
export const PARSE_TIMEOUT_MS = 5000;
/** Parse workers at a time in this process: each may hold some 112 MB of heap. */
export const MAX_PARSE_WORKERS = 2;

let running = 0;
/** Workers that have not exited yet (a terminated worker counts until its exit event). */
export const parseWorkersRunning = () => running;

type Reply = { track: Track } | { code: GpxErrorCode };

/**
 * parseGpx in a Worker with its own heap and time caps (B1): saxes buffers a whole comment, text
 * node, CDATA, PI or attribute value, so a hostile file exhausts the worker, never the API. Out of
 * memory or over time → GpxError GPX_TOO_COMPLEX; more than MAX_PARSE_WORKERS at a time → 503
 * PARSE_BUSY; any other worker failure is a server error (500).
 * ponytail: one Worker per upload, started for each parse (a new isolate and module load, tens of
 * ms); the per-user throttle and the cap bound the rate. A pool when uploads are frequent.
 */
export function parseGpxIsolated(bytes: Uint8Array, timeoutMs = PARSE_TIMEOUT_MS): Promise<Track> {
  if (running >= MAX_PARSE_WORKERS) {
    return Promise.reject(new ServiceUnavailableException({ statusCode: 503, code: 'PARSE_BUSY', message: 'PARSE_BUSY' }));
  }
  // A copy with its own buffer is transferred: the caller keeps `bytes` (a Buffer may share a pool).
  const copy = new Uint8Array(bytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      workerData: copy,
      transferList: [copy.buffer],
      resourceLimits: PARSE_LIMITS,
      execArgv: TS ? ['--import', 'tsx'] : [],
    });
    // The slot is freed on exit only: a timed-out worker runs until terminate() completes.
    running++;
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
      running--;
      clearTimeout(timer);
      reject(new Error(`GPX worker exited with code ${code} before it answered`));
    });
  });
}
