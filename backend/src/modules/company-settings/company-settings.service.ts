import { Injectable } from '@nestjs/common';

import { RequestActor } from '../../common/interfaces/request-actor.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

@Injectable()
export class CompanySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getSettings() {
    const settings = await this.ensureSettings();

    return this.loadSettings(settings.id);
  }

  async updateSettings(
    payload: UpdateCompanySettingsDto,
    actor?: RequestActor,
  ) {
    const settings = await this.ensureSettings();

    await this.prisma.$transaction(async (tx) => {
      await tx.companySettings.update({
        where: {
          id: settings.id,
        },
        data: {
          companyName: payload.companyName,
          currencyName: payload.currencyName,
          primaryColor: payload.primaryColor,
          smtpEnabled: payload.smtpEnabled,
          expirationMonths: payload.expirationMonths,
          expirationWarningDays: payload.expirationWarningDays,
        },
      });

      if (payload.pickupPoints) {
        await tx.pickupPoint.deleteMany({
          where: {
            companySettingsId: settings.id,
          },
        });

        if (payload.pickupPoints.length > 0) {
          await tx.pickupPoint.createMany({
            data: payload.pickupPoints.map((point) => ({
              companySettingsId: settings.id,
              name: point.name ?? 'Новая точка выдачи',
              address: point.address,
              description: point.description,
              isActive: point.isActive ?? true,
            })),
          });
        }
      }
    });

    const updated = await this.loadSettings(settings.id);

    await this.auditService.createEvent({
      actorId: actor?.userId ?? null,
      action: 'company_settings.updated',
      entityType: 'CompanySettings',
      entityId: settings.id,
      payload: {
        companyName: updated.companyName,
        currencyName: updated.currencyName,
        smtpEnabled: updated.smtpEnabled,
        expirationMonths: updated.expirationMonths,
        expirationWarningDays: updated.expirationWarningDays,
      },
    });

    return updated;
  }

  private async ensureSettings() {
    return this.prisma.companySettings.upsert({
      where: {
        id: 'default',
      },
      update: {},
      create: {
        id: 'default',
        companyName: 'Merchshop Demo Company',
        currencyName: 'Баллы',
        primaryColor: '#2F6FED',
        expirationMonths: 12,
        expirationWarningDays: 30,
      },
    });
  }

  private async loadSettings(id: string) {
    return this.prisma.companySettings.findUniqueOrThrow({
      where: {
        id,
      },
      include: {
        pickupPoints: {
          orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        },
      },
    });
  }
}
