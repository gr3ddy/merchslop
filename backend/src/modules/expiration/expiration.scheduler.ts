import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ExpirationService } from './expiration.service';

@Injectable()
export class ExpirationScheduler {
  private readonly logger = new Logger(ExpirationScheduler.name);

  constructor(private readonly expirationService: ExpirationService) {}

  @Cron('0 4 * * *')
  async handleWarningSweep(): Promise<void> {
    const result = await this.expirationService.runWarningSweep();
    this.logger.log(
      `Warning sweep completed: ${result.notificationsCreated} notifications, ${result.lotsWarned} lots, ${result.totalWarningAmount} points.`,
    );
  }

  @Cron('30 4 * * *')
  async handleExpirationSweep(): Promise<void> {
    const result = await this.expirationService.runExpirationSweep();
    this.logger.log(
      `Expiration sweep completed: ${result.transactionsCreated} transactions, ${result.expiredLots} lots, ${result.totalExpiredAmount} points.`,
    );
  }
}
