import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AccrualReasonsController } from './accrual-reasons.controller';
import { AccrualReasonsService } from './accrual-reasons.service';

@Module({
  imports: [AuditModule],
  controllers: [AccrualReasonsController],
  providers: [AccrualReasonsService],
  exports: [AccrualReasonsService],
})
export class AccrualReasonsModule {}
