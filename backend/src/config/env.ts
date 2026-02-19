import dotenv from 'dotenv';

dotenv.config();

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return fallback;
};

const routerContainerDefault = Boolean(process.env.DOCKER_NETWORK && process.env.DOCKER_NETWORK.length > 0);
const healthUseContainerTargets = parseBoolean(
  process.env.HEALTH_USE_CONTAINER_TARGETS,
  routerContainerDefault,
);

export const env = {
  port: 4201,
  databaseUrl: process.env.DATABASE_URL ?? 'file:./dev.db',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  healthCheckIntervalMs: Number(process.env.HEALTH_CHECK_INTERVAL_MS ?? 30000),
  caddyAdminUrl: process.env.CADDY_ADMIN_URL ?? '',
  dockerAutostart: parseBoolean(process.env.DOCKER_AUTOSTART, true),
  dockerNetwork: process.env.DOCKER_NETWORK ?? '',
  routerTargetHost: (process.env.ROUTER_TARGET_HOST ?? 'http://localhost').replace(/\/$/, ''),
  routerDomain: (process.env.ROUTER_DOMAIN ?? 'switchyard.localhost').replace(/^\./, ''),
  healthUseContainerTargets,
  portRangeStart: Number(process.env.PORT_RANGE_START ?? 4100),
  portRangeEnd: Number(process.env.PORT_RANGE_END ?? 4700),
  consoleSubdomain: (process.env.ROUTER_CONSOLE_SUBDOMAIN ?? 'console').trim(),
  consoleTargetOrigin: (process.env.CONSOLE_TARGET_ORIGIN ?? 'http://frontend:80').replace(/\/$/, ''),
};

export type Role = 'viewer' | 'operator' | 'admin';
