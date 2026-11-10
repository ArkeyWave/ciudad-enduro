import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

/** Builds the OpenAPI document without instantiating providers (no env, no database). */
export async function createOpenApiDocument(): Promise<OpenAPIObject> {
  const app = configureApp(await NestFactory.create(AppModule, { preview: true, logger: false }));
  const config = new DocumentBuilder().setTitle('Ciudad Enduro API').setVersion('0').build();
  const document = SwaggerModule.createDocument(app, config);
  await app.close();
  return document;
}
