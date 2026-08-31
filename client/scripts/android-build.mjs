import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const task = process.argv[2];
const supportedTasks = new Set(['assembleDebug', 'assembleRelease', 'bundleRelease', 'validateReleaseSigning']);

if (!supportedTasks.has(task)) {
  throw new Error(`Unsupported Android Gradle task: ${task ?? '(missing)'}`);
}

const androidDirectory = fileURLToPath(new URL('../android/', import.meta.url));
const gradleCommand = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const gradlePath = join(androidDirectory, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');

if (!existsSync(gradlePath)) {
  throw new Error(`Android Gradle wrapper was not found at ${gradlePath}`);
}

const command = process.platform === 'win32' ? 'cmd.exe' : gradleCommand;
const args = process.platform === 'win32'
  ? ['/d', '/c', `call "${gradlePath}" ${task}`]
  : [task];

const result = spawnSync(command, args, {
  cwd: androidDirectory,
  stdio: 'inherit',
  windowsVerbatimArguments: process.platform === 'win32'
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
