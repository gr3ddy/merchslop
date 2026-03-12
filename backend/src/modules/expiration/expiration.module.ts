import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { CompanySettingsModule } from '../company-settings/company-settings.module';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExpirationController } from './expiration.controller';
import { ExpirationScheduler } from './expiration.scheduler';
import { ExpirationService } from './expiration.service';

@Module({
  imports: [AuditModule, CompanySettingsModule, LedgerModule, NotificationsModule],
  controllers: [ExpirationController],
  providers: [ExpirationService, ExpirationScheduler],
  exports: [ExpirationService],
})
export class ExpirationModule {}
