import { ValidationPipe, type INestApplication } from '@nestjs/common';

/** Shared by main.ts and the OpenAPI emitter, so the document matches the served routes. */
export function configureApp<T extends INestApplication>(app: T): T {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  return app;
}
