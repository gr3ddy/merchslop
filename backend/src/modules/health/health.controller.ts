import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly configService: ConfigService) {}

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
}

