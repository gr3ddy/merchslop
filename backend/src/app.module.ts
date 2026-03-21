import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { HttpExceptionLoggingFilter } from './common/filters/http-exception-logging.filter';
import { RolesGuard } from './common/guards/roles.guard';
import { RequestActorMiddleware } from './common/middleware/request-actor.middleware';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import appConfig from './config/app.config';
import { validateEnvironment } from './config/env.validation';
import { AuditModule } from './modules/audit/audit.module';
import { AccrualReasonsModule } from './modules/accrual-reasons/accrual-reasons.module';
import { AuthModule } from './modules/auth/auth.module';
import { CartModule } from './modules/cart/cart.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CompanySettingsModule } from './modules/company-settings/company-settings.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { ExpirationModule } from './modules/expiration/expiration.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TransactionsModule } from './modules/transactions/transactions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
      load: [appConfig],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    AuthModule,
    CartModule,
    CompanySettingsModule,
    EmployeesModule,
    ExpirationModule,
    AccrualReasonsModule,
    TransactionsModule,
    CatalogModule,
    OrdersModule,
    ReportsModule,
    NotificationsModule,
    AuditModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionLoggingFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware, RequestActorMiddleware)
      .forRoutes({
      path: '*path',
      method: RequestMethod.ALL,
    });
  }
}
