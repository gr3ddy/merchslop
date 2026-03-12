import { registerAs } from '@nestjs/config';

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export default registerAs('app', () => ({
  name: process.env.APP_NAME ?? 'Merchshop Backend',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  swaggerEnabled: parseBoolean(process.env.SWAGGER_ENABLED, true),
}));

