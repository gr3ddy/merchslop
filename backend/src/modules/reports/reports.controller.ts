import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { ListBalanceReportQueryDto } from './dto/list-balance-report-query.dto';
import { ListOrderReportQueryDto } from './dto/list-order-report-query.dto';
import { ListTransactionReportQueryDto } from './dto/list-transaction-report-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@DevActorHeaders()
@Roles(UserRole.PROGRAM_ADMIN)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('balances')
  @ApiOperation({ summary: 'Lists employee balances report.' })
  listBalances(@Query() query: ListBalanceReportQueryDto) {
    return this.reportsService.listBalances(query);
  }

  @Get('balances/export')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Exports employee balances report as CSV.' })
  async exportBalances(
    @Query() query: ListBalanceReportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const csv = await this.reportsService.exportBalancesCsv(query);
    this.sendCsv(response, 'balances-report.csv', csv);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Lists transaction history report.' })
  listTransactions(@Query() query: ListTransactionReportQueryDto) {
    return this.reportsService.listTransactions(query);
  }

  @Get('transactions/export')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Exports transaction history report as CSV.' })
  async exportTransactions(
    @Query() query: ListTransactionReportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const csv = await this.reportsService.exportTransactionsCsv(query);
    this.sendCsv(response, 'transactions-report.csv', csv);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Lists orders report.' })
  listOrders(@Query() query: ListOrderReportQueryDto) {
    return this.reportsService.listOrders(query);
  }

  @Get('orders/export')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Exports orders report as CSV.' })
  async exportOrders(
    @Query() query: ListOrderReportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const csv = await this.reportsService.exportOrdersCsv(query);
    this.sendCsv(response, 'orders-report.csv', csv);
  }

  private sendCsv(response: Response, fileName: string, csv: string): void {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.send(csv);
  }
}
