import { Test } from '@nestjs/testing';
import { expect, it } from 'vitest';
import { Clock } from './fixtures/metadata/clock.js';
import { Reporter } from './fixtures/metadata/reporter.js';

it('resolves a provider from another file through decorator metadata', async () => {
  const moduleRef = await Test.createTestingModule({ providers: [Clock, Reporter] }).compile();
  expect(moduleRef.get(Reporter).report()).toBe('tick');
});
