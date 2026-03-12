import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { CompanySettingsModule } from '../company-settings/company-settings.module';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [AuditModule, NotificationsModule, CompanySettingsModule, LedgerModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
