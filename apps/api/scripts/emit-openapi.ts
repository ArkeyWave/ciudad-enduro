import { mkdir, writeFile } from 'node:fs/promises';
import { createOpenApiDocument } from '../src/openapi.js';

// Writes the API contract for packages/api-client. Sorted keys keep the diff stable.
const target = new URL('../../../packages/api-client/openapi.json', import.meta.url);

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => [key, sortKeys(child)]),
  );
}

const document = await createOpenApiDocument();
await mkdir(new URL('.', target), { recursive: true });
await writeFile(target, `${JSON.stringify(sortKeys(document), null, 2)}\n`);
