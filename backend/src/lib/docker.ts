import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type DockerRunOptions = {
  name: string;
  image: string;
  hostPort: number;
  containerPort: number;
  env?: Record<string, string>;
  network?: string;
};

const runDockerCommand = async (args: string[]) => {
  await execFileAsync('docker', args).catch((error) => {
    // Ignore non-zero exit for stop/rm commands when containers do not exist.
    if (args[0] === 'stop' || (args[0] === 'rm' && args.includes('-f'))) {
      return;
    }
    throw error;
  });
};

export const removeDockerContainer = async (name: string) => {
  await runDockerCommand(['rm', '-f', name]);
};

export const stopDockerContainer = async (name: string) => {
  await runDockerCommand(['stop', name]);
};

export const ensureDockerContainer = async ({
  name,
  image,
  hostPort,
  containerPort,
  env = {},
  network,
}: DockerRunOptions) => {
  await removeDockerContainer(name).catch(() => undefined);

  const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);

  const args = ['run', '-d', '--name', name, '--restart', 'unless-stopped', '-p', `${hostPort}:${containerPort}`];
  if (network) {
    args.push('--network', network);
  }
  args.push(...envArgs, image);
  await execFileAsync('docker', args);
};

export const getDockerContainerState = async (
  name: string,
): Promise<'running' | 'stopped' | 'missing'> => {
  try {
    const { stdout } = await execFileAsync('docker', ['inspect', '--format', '{{.State.Status}}', name]);
    const status = stdout.trim().toLowerCase();
    if (status === 'running') return 'running';
    return 'stopped';
  } catch {
    return 'missing';
  }
};
