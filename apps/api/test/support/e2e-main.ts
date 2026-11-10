// Test-only API entrypoint for the web e2e suite (B5). It is the real AppModule with one change:
// OTP mails are appended to E2E_CODES_FILE (one JSON line `{"to","otp"}` per mail) instead of
// going to Resend. Playwright reads that file; the codes never travel over HTTP. Captcha tokens
// are checked against an in-process siteverify stub (the web e2e stubs the widget script).
// Run from apps/api: node --import @swc-node/register/esm-register test/support/e2e-main.ts
import { appendFileSync, writeFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { TURNSTILE_SITEVERIFY_URL } from '../../src/auth/auth.module.js';
import { MAIL_TRANSPORT, type MailTransport } from '../../src/auth/mailer.js';
import { ENV, loadEnv } from '../../src/config/env.js';
import { configureApp } from '../../src/configure-app.js';
import { startTurnstileStub } from './turnstile-stub.js';

const env = loadEnv();
if (env.NODE_ENV !== 'test') throw new Error('e2e-main runs only with NODE_ENV=test');
const codesFile = process.env.E2E_CODES_FILE;
if (!codesFile) throw new Error('E2E_CODES_FILE is required');
writeFileSync(codesFile, '');

const transport: MailTransport = (message) => {
  appendFileSync(codesFile, `${JSON.stringify({ to: message.to, otp: /\b\d{6}\b/.exec(message.text)?.[0] })}\n`);
  return Promise.resolve();
};

const turnstile = await startTurnstileStub();

const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(ENV)
  .useValue(env)
  .overrideProvider(MAIL_TRANSPORT)
  .useValue(transport)
  .overrideProvider(TURNSTILE_SITEVERIFY_URL)
  .useValue(turnstile.url)
  .compile();
const app = configureApp(moduleRef.createNestApplication({ bodyParser: false }));
app.enableShutdownHooks();
await app.listen(env.PORT, '127.0.0.1');
