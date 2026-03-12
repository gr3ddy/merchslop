import { PartialType } from '@nestjs/swagger';

import { CreateAccrualReasonDto } from './create-accrual-reason.dto';

export class UpdateAccrualReasonDto extends PartialType(CreateAccrualReasonDto) {}

