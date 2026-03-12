import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CompanySettingsModule } from '../company-settings/company-settings.module';
import { MailerService } from './mailer.service';

@Module({
  imports: [ConfigModule, CompanySettingsModule],
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {}
