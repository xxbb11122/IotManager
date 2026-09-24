import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve IOT_SECRET_DIR exactly as Compose resolves a relative bind source:
 * relative to the directory containing deploy/docker-compose.yml.
 *
 * path.win32.isAbsolute is also checked when running under POSIX Node so a
 * Windows absolute path passed from Git Bash remains an absolute path.
 */
export function resolveSecretDirectory(repositoryRoot, configuredPath) {
  const value = configuredPath?.trim();
  if (!value) throw new Error('IOT_SECRET_DIR must not be empty.');
  const isAbsolute = path.isAbsolute(value) || path.win32.isAbsolute(value);
  if (isAbsolute) return path.normalize(value);
  return path.resolve(repositoryRoot, 'deploy', value.replace(/^(\.\/|\.\\)+/, ''));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.stdout.write(`${resolveSecretDirectory(process.argv[2], process.argv[3])}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 64;
  }
}
