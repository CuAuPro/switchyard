const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

const { protocol, hostname, host, port } = window.location;
const isStrictLocalHost = LOCAL_HOSTS.has(hostname);
const isLocalNgServe = isStrictLocalHost && port === '4200';

const configuredApiBase = (window as any).__SWITCHYARD_API_BASE__ as string | undefined;
const configuredWsBase = (window as any).__SWITCHYARD_WS_BASE__ as string | undefined;

const httpBase =
  configuredApiBase ??
  (isLocalNgServe ? `${protocol}//${hostname}:4201` : `${protocol}//${host}`);
const wsScheme = protocol === 'https:' ? 'wss' : 'ws';
const wsBase =
  configuredWsBase ??
  (isLocalNgServe ? `${wsScheme}://${hostname}:4201` : `${wsScheme}://${host}`);

export const appEnv = {
  apiBaseUrl: `${httpBase}/api`,
  wsBaseUrl: `${wsBase}/ws`,
};
