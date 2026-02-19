const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

const { protocol, hostname, host } = window.location;
const isLocalHost = LOCAL_HOSTS.has(hostname);

const configuredApiBase = (window as any).__SWITCHYARD_API_BASE__ as string | undefined;
const configuredWsBase = (window as any).__SWITCHYARD_WS_BASE__ as string | undefined;

const httpBase =
  configuredApiBase ??
  (isLocalHost ? `${protocol}//${hostname}:4201` : `${protocol}//${host}`);
const wsScheme = protocol === 'https:' ? 'wss' : 'ws';
const wsBase =
  configuredWsBase ??
  (isLocalHost ? `${wsScheme}://${hostname}:4201` : `${wsScheme}://${host}`);

export const appEnv = {
  apiBaseUrl: `${httpBase}/api`,
  wsBaseUrl: `${wsBase}/ws`,
};
