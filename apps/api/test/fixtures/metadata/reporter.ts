import { Injectable } from '@nestjs/common';
import { Clock } from './clock.js';

// No @Inject(): Nest resolves Clock only through the emitted design:paramtypes metadata.
@Injectable()
export class Reporter {
  constructor(private readonly clock: Clock) {}

  report(): string {
    return this.clock.now();
  }
}
