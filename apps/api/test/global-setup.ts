import type { TestProject } from 'vitest/node';
import { prepareTestDatabase } from './test-db.js';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<void> {
  const url = await prepareTestDatabase(process.env.DATABASE_URL, process.env.TEST_DB_SUFFIX);
  project.provide('testDatabaseUrl', url);
}
