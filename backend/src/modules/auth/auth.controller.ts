import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentActor } from '../../common/decorators/current-actor.decorator';
import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { AuthService } from './auth.service';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@DevActorHeaders()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('session')
  @ApiOperation({
    summary: 'Returns current actor context and resolved user information.',
  })
  getSession(@CurrentActor() actor?: RequestActor) {
    return this.authService.getSession(actor);
  }

  @Post('bootstrap-admin')
  @ApiOperation({
    summary: 'Creates the first program admin if the system has no users yet.',
  })
  bootstrapAdmin(@Body() payload: BootstrapAdminDto) {
    return this.authService.bootstrapAdmin(payload);
  }

  @Post('login')
  @ApiOperation({ summary: 'Authenticates user and returns JWT access token.' })
  login(@Body() payload: LoginDto) {
    return this.authService.login(payload);
  }
}
