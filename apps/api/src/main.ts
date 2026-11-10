import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ENV, type Env } from './config/env.js';
import { configureApp } from './configure-app.js';

// apps/api/.env for local development (gitignored).
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Better Auth reads the raw body of /api/auth/*; its module parses JSON for the other routes.
const app = configureApp(await NestFactory.create(AppModule, { bodyParser: false }));
app.enableShutdownHooks();
await app.listen(app.get<Env>(ENV).PORT);
