#!/usr/bin/env node
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative, resolve } = require('node:path');

const repositoryRoot = resolve(__dirname, '..');
// Scan the full build inputs, not only src/: a Vite credential could also be
// introduced through a local .env file, configuration file, or build script.
const sourceRoots = ['frontend', 'console', 'client', 'shared'];
const ignoredDirectories = new Set(['node_modules', 'dist', 'build', '.gradle', 'coverage', 'test-results']);
const publicSecretPattern = /\bVITE_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z0-9_]*\b/g;

function filesIn(directory) {
  const absoluteDirectory = join(repositoryRoot, directory);
  const result = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) result.push(...filesIn(join(directory, entry.name)));
      continue;
    }
    if (entry.isFile()) result.push(join(directory, entry.name));
  }
  return result;
}

const violations = [];
for (const sourceRoot of sourceRoots) {
  for (const file of filesIn(sourceRoot)) {
    const absoluteFile = join(repositoryRoot, file);
    if (!statSync(absoluteFile).isFile()) continue;
    const contents = readFileSync(absoluteFile, 'utf8');
    for (const match of contents.matchAll(publicSecretPattern)) {
      const before = contents.slice(0, match.index);
      const line = before.split('\n').length;
      violations.push(`${relative(repositoryRoot, absoluteFile)}:${line}: ${match[0]}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Public Vite environment variables must not carry credentials:');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error('Use the OIDC runtime session or a protected server-side secret instead.');
  process.exit(1);
}

console.log('Public Vite environment policy passed.');
