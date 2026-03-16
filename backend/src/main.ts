import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { PrismaService } from './modules/prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const apiPrefix = configService.get<string>('app.apiPrefix') ?? 'api';
  const swaggerEnabled = configService.get<boolean>('app.swaggerEnabled') ?? true;
  const appName = configService.get<string>('app.name') ?? 'Merchshop Backend';
  const port = configService.get<number>('app.port') ?? 3000;
  const prismaService = app.get(PrismaService);
  const uploadsRoot = resolve(process.cwd(), 'uploads');

  await mkdir(uploadsRoot, { recursive: true });

  app.use(
    helmet({
      // Frontend can load product images from backend static assets.
      crossOriginResourcePolicy: {
        policy: 'cross-origin',
      },
    }),
  );
  app.useStaticAssets(uploadsRoot, {
    prefix: '/uploads/',
  });
  app.setGlobalPrefix(apiPrefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(appName)
        .setDescription('Merchshop MVP backend API')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );

    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  await prismaService.enableShutdownHooks(app);
  await app.listen(port);
}

void bootstrap();
