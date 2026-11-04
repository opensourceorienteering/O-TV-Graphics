import { createServer } from 'net';

export class PortInUseError extends Error {
  readonly code = 'EADDRINUSE';

  constructor(port: number) {
    super(`Port ${port} is already in use.`);
    this.name = 'PortInUseError';
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.once('listening', () => {
      server.close(error => error ? reject(error) : resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

export async function findAvailablePort(
  startPort: number,
  excludedPorts: readonly number[] = [],
): Promise<number> {
  const firstPort = Number.isInteger(startPort) && startPort >= 1024 && startPort <= 65535
    ? startPort
    : 1024;
  const portCount = 65535 - 1024 + 1;

  for (let offset = 0; offset < portCount; offset++) {
    const port = 1024 + ((firstPort - 1024 + offset) % portCount);
    if (excludedPorts.includes(port)) continue;
    if (await isPortAvailable(port)) return port;
  }

  throw new Error('No available port found in the allowed range (1024–65535).');
}
