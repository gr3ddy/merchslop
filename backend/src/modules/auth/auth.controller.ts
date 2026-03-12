import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentActor } from '../../common/decorators/current-actor.decorator';
import { DevActorHeaders } from '../../common/decorators/dev-actor-headers.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enum';
import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { AuthService } from './auth.service';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { CompletePasswordActionDto } from './dto/complete-password-action.dto';
import { IssueInviteDto } from './dto/issue-invite.dto';
import { IssuePasswordResetDto } from './dto/issue-password-reset.dto';
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

  @Post('invite')
  @ApiBearerAuth()
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiOperation({
    summary:
      'Issues an invite token for an employee account so the employee can set the first password.',
  })
  issueInvite(
    @Body() payload: IssueInviteDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.authService.issueInvite(payload, actor);
  }

  @Post('password/reset-token')
  @ApiBearerAuth()
  @Roles(UserRole.PROGRAM_ADMIN)
  @ApiOperation({
    summary:
      'Issues a password reset token for an active employee account. Intended for manual sharing or future email delivery.',
  })
  issuePasswordReset(
    @Body() payload: IssuePasswordResetDto,
    @CurrentActor() actor?: RequestActor,
  ) {
    return this.authService.issuePasswordReset(payload, actor);
  }

  @Post('password/complete')
  @ApiOperation({
    summary:
      'Accepts invite or reset token, sets a new password, activates the employee account and returns JWT.',
  })
  completePasswordAction(@Body() payload: CompletePasswordActionDto) {
    return this.authService.completePasswordAction(payload);
  }
}
