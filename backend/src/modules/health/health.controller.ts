import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Simple health endpoint for service liveness.' })
  getHealth(): {
    status: 'ok';
    service: string;
    timestamp: string;
  } {
    return {
      status: 'ok',
      service: this.configService.get<string>('app.name') ?? 'Merchshop Backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness endpoint with database connectivity check.' })
  async getReadiness(): Promise<{
    status: 'ok';
    service: string;
    environment: string;
    timestamp: string;
    checks: {
      database: 'up';
    };
  }> {
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is not reachable.');
    }

    return {
      status: 'ok',
      service: this.configService.get<string>('app.name') ?? 'Merchshop Backend',
      environment:
        this.configService.get<string>('app.nodeEnv') ?? 'development',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'up',
      },
    };
  }
}
