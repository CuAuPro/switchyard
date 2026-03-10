import { execFile } from 'child_process';
import { promisify } from 'util';
import { spawn } from 'child_process';

const execFileAsync = promisify(execFile);

export type DockerRegistryAuth = {
  registry?: string;
  username: string;
  password: string;
};

export type DockerRunOptions = {
  name: string;
  image: string;
  hostPort: number;
  containerPort: number;
  env?: Record<string, string>;
  network?: string;
  registryAuth?: DockerRegistryAuth;
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
  registryAuth,
}: DockerRunOptions) => {
  if (registryAuth?.username && registryAuth?.password) {
    const args = ['login'];
    if (registryAuth.registry) args.push(registryAuth.registry);
    args.push('-u', registryAuth.username, '--password-stdin');
    await new Promise<void>((resolve, reject) => {
      const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `docker login failed with exit code ${code}`));
      });
      child.stdin.write(registryAuth.password);
      child.stdin.end();
    });
  }
  // Always pull first so mutable tags like "latest" refresh before container recreation.
  await execFileAsync('docker', ['pull', image]);
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
