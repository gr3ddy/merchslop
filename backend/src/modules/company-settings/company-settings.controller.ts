import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentActor } from '../../common/decorators/current-actor.decorator';
import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { CompanySettingsService } from './company-settings.service';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

@ApiTags('company-settings')
@ApiBearerAuth()
@DevActorHeaders()
@Controller('company-settings')
export class CompanySettingsController {
  constructor(
    private readonly companySettingsService: CompanySettingsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Returns current company-scoped runtime settings.' })
  getSettings() {
    return this.companySettingsService.getSettings();
  }

  @Patch()
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiOperation({ summary: 'Updates company settings in persistent storage.' })
  updateSettings(
    @Body() payload: UpdateCompanySettingsDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.companySettingsService.updateSettings(payload, actor);
  }
}
