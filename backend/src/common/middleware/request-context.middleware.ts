import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestContextMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = this.resolveRequestId(req);
    const startedAt = Date.now();

    req.requestId = requestId;
    req.requestStartedAt = startedAt;
    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const payload = {
        requestId,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs,
        actorId: req.actor?.userId ?? null,
        actorRole: req.actor?.role ?? null,
        authMode: req.actor?.authMode ?? null,
      };
      const message = JSON.stringify(payload);

      if (res.statusCode >= 500) {
        this.logger.error(message);
        return;
      }

      if (res.statusCode >= 400 || durationMs >= 1000) {
        this.logger.warn(message);
        return;
      }

      this.logger.log(message);
    });

    next();
  }

  private resolveRequestId(req: Request): string {
    const headerValue = req.headers['x-request-id'];
    const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const normalized = candidate?.trim();

    if (normalized) {
      return normalized;
    }

    return randomUUID();
  }
}
