import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasswordActionTokenType } from '@prisma/client';
import nodemailer, { Transporter } from 'nodemailer';

import { CompanySettingsService } from '../company-settings/company-settings.service';

type MailDeliveryMode = 'email' | 'manual';

type MailDeliveryResult = {
  mode: MailDeliveryMode;
  sent: boolean;
  reason: string | null;
  recipient: string;
  messageId: string | null;
};

type PasswordActionEmailInput = {
  to: string;
  fullName: string;
  employeeNumber: string;
  type: PasswordActionTokenType;
  token: string;
  expiresAt: Date;
};

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: Transporter | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly companySettingsService: CompanySettingsService,
  ) {}

  async sendPasswordActionEmail(
    input: PasswordActionEmailInput,
  ): Promise<MailDeliveryResult> {
    const settings = await this.companySettingsService.getSettings();
    const availability = this.getAvailability(settings.smtpEnabled);
    const appName =
      settings.companyName ||
      this.configService.get<string>('APP_NAME') ||
      'Merchshop';

    if (!availability.enabled) {
      return {
        mode: 'manual',
        sent: false,
        reason: availability.reason,
        recipient: input.to,
        messageId: null,
      };
    }

    try {
      const link = this.buildPasswordActionLink(input.type, input.token);
      const content = this.renderPasswordActionMessage(input, link, appName);
      const result = await this.getTransporter().sendMail({
        from: this.buildFromAddress(appName),
        to: input.to,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });

      return {
        mode: 'email',
        sent: true,
        reason: null,
        recipient: input.to,
        messageId: result.messageId ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      this.logger.error(`Failed to send SMTP email to ${input.to}: ${message}`);

      return {
        mode: 'manual',
        sent: false,
        reason: 'smtp_send_failed',
        recipient: input.to,
        messageId: null,
      };
    }
  }

  private getAvailability(smtpEnabled: boolean): {
    enabled: boolean;
    reason: string | null;
  } {
    if (!smtpEnabled) {
      return {
        enabled: false,
        reason: 'smtp_disabled',
      };
    }

    if (!this.configService.get<string>('SMTP_HOST')) {
      return {
        enabled: false,
        reason: 'smtp_host_missing',
      };
    }

    if (!this.resolveFromEmail()) {
      return {
        enabled: false,
        reason: 'smtp_from_missing',
      };
    }

    return {
      enabled: true,
      reason: null,
    };
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const port = Number(this.configService.get<string>('SMTP_PORT') ?? '587');
      const secure = this.parseBoolean(
        this.configService.get<string>('SMTP_SECURE'),
        port === 465,
      );
      const user = this.configService.get<string>('SMTP_USER');
      const pass = this.configService.get<string>('SMTP_PASS');

      this.transporter = nodemailer.createTransport({
        host: this.configService.get<string>('SMTP_HOST'),
        port,
        secure,
        auth: user ? { user, pass } : undefined,
      });
    }

    return this.transporter;
  }

  private buildPasswordActionLink(
    type: PasswordActionTokenType,
    token: string,
  ): string | null {
    const publicAppUrl = this.configService.get<string>('PUBLIC_APP_URL');

    if (!publicAppUrl) {
      return null;
    }

    const url = new URL('/auth/password/complete', publicAppUrl);
    url.searchParams.set('token', token);
    url.searchParams.set('mode', type.toLowerCase());

    return url.toString();
  }

  private renderPasswordActionMessage(
    input: PasswordActionEmailInput,
    link: string | null,
    appName: string,
  ): {
    subject: string;
    text: string;
    html: string;
  } {
    const actionLabel =
      input.type === PasswordActionTokenType.INVITE
        ? 'set your password'
        : 'reset your password';
    const subject =
      input.type === PasswordActionTokenType.INVITE
        ? `${appName}: complete your employee invitation`
        : `${appName}: password reset`;
    const expiresAtLabel = input.expiresAt.toISOString();
    const greeting = `Hello ${input.fullName},`;
    const intro =
      input.type === PasswordActionTokenType.INVITE
        ? `You have been invited to ${appName}. Use the details below to set your password.`
        : `A password reset was requested for your ${appName} account.`;
    const linkBlock = link
      ? `Open this link to ${actionLabel}: ${link}`
      : `No direct app URL is configured, so use the token below to ${actionLabel}.`;
    const text = [
      greeting,
      '',
      intro,
      '',
      linkBlock,
      `Token: ${input.token}`,
      `Employee number: ${input.employeeNumber}`,
      `Expires at: ${expiresAtLabel}`,
      '',
      'If you did not expect this email, please contact your administrator.',
    ].join('\n');

    const html = [
      `<p>${greeting}</p>`,
      `<p>${intro}</p>`,
      link
        ? `<p><a href="${link}">Open this link to ${actionLabel}</a></p>`
        : '<p>No direct app URL is configured, so use the token below manually.</p>',
      '<p>',
      `<strong>Token:</strong> ${input.token}<br />`,
      `<strong>Employee number:</strong> ${input.employeeNumber}<br />`,
      `<strong>Expires at:</strong> ${expiresAtLabel}`,
      '</p>',
      '<p>If you did not expect this email, please contact your administrator.</p>',
    ].join('');

    return {
      subject,
      text,
      html,
    };
  }

  private buildFromAddress(appName: string): string {
    const fromEmail = this.resolveFromEmail();
    const fromName = this.configService.get<string>('SMTP_FROM_NAME') ?? appName;

    return fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
  }

  private resolveFromEmail(): string {
    return (
      this.configService.get<string>('SMTP_FROM_EMAIL') ??
      this.configService.get<string>('SMTP_USER') ??
      ''
    );
  }

  private parseBoolean(
    value: string | undefined,
    defaultValue: boolean,
  ): boolean {
    if (value === undefined) {
      return defaultValue;
    }

    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }
}
