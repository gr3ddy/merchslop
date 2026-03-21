import { RequestActor } from '../interfaces/request-actor.interface';

declare global {
  namespace Express {
    interface Request {
      actor?: RequestActor;
      requestId?: string;
      requestStartedAt?: number;
    }
  }
}

export {};
