import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ENV, type Env } from './config/env.js';
import { configureApp } from './configure-app.js';

// apps/api/.env for local development (gitignored).
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const app = configureApp(await NestFactory.create(AppModule));
app.enableShutdownHooks();
await app.listen(app.get<Env>(ENV).PORT);
