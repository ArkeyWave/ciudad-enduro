import { Injectable } from '@nestjs/common';

@Injectable()
export class Clock {
  now(): string {
    return 'tick';
  }
}
