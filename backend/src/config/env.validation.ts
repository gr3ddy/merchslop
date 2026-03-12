type EnvironmentMap = Record<string, string | undefined>;

function requireNonEmpty(env: EnvironmentMap, key: string): void {
  if (!env[key] || env[key]?.trim() === '') {
    throw new Error(`Environment variable "${key}" is required.`);
  }
}

function requireNumberIfPresent(env: EnvironmentMap, key: string): void {
  const value = env[key];

  if (value === undefined || value === '') {
    return;
  }

  if (Number.isNaN(Number(value))) {
    throw new Error(`Environment variable "${key}" must be a valid number.`);
  }
}

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const env = config as EnvironmentMap;

  requireNonEmpty(env, 'DATABASE_URL');
  requireNumberIfPresent(env, 'PORT');

  return config;
}

