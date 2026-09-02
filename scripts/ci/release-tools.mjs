#!/usr/bin/env node
/**
 * Release-integrity helpers shared by the shell entry points in this folder.
 *
 * The commands deliberately use Docker Compose's resolved JSON rather than a
 * hand-maintained service list.  The small, explicit catalog below is only an
 * approval boundary: it binds a resolved service to its release artifact ID.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');

const artifactCatalog = [
  { artifactId: 'IMG-R01', imageVariable: 'IOT_BACKEND_IMAGE', services: ['backend'] },
  { artifactId: 'IMG-R02', imageVariable: 'IOT_CADDY_IMAGE', services: ['caddy'] },
  { artifactId: 'IMG-R03', imageVariable: 'IOT_KEYCLOAK_IMAGE', services: ['keycloak'] },
  { artifactId: 'IMG-R04', imageVariable: 'IOT_POSTGRES_IMAGE', services: ['postgres', 'wal-g-archive', 'wal-g-backup', 'wal-g-recovery'] },
  { artifactId: 'IMG-R05', imageVariable: 'IOT_PROMETHEUS_IMAGE', services: ['prometheus'] },
  { artifactId: 'IMG-R06', imageVariable: 'IOT_ALERTMANAGER_IMAGE', services: ['alertmanager'] },
  { artifactId: 'IMG-R07', imageVariable: 'IOT_LOGICAL_BACKUP_IMAGE', services: ['backup'] },
  { artifactId: 'IMG-R08', imageVariable: 'IOT_VOLUME_INIT_IMAGE', services: ['volume-init', 'secret-volume-init', 'observability-volume-init'] }
];

const serviceOrder = [
  'volume-init',
  'secret-volume-init',
  'postgres',
  'keycloak',
  'backend',
  'backup',
  'wal-g-archive',
  'wal-g-backup',
  'alertmanager',
  'observability-volume-init',
  'prometheus',
  'caddy',
  'wal-g-recovery'
];

const serviceLifecycle = {
  'volume-init': 'one-shot-volume-init',
  'secret-volume-init': 'one-shot-secret-init',
  'observability-volume-init': 'one-shot-observability-init',
  'wal-g-recovery': 'one-shot-recovery'
};

function fail(message, exitCode) {
  const error = new Error(message);
  error.exitCode = exitCode || 1;
  throw error;
}

function output(message) {
  process.stdout.write(String(message) + '\n');
}

function parseArguments(tokens) {
  const values = new Map();
  const positionals = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf('=');
    const key = token.slice(2, equals === -1 ? undefined : equals);
    let value = true;
    if (equals !== -1) {
      value = token.slice(equals + 1);
    } else if (tokens[index + 1] && !tokens[index + 1].startsWith('--')) {
      value = tokens[index + 1];
      index += 1;
    }
    const existing = values.get(key) || [];
    existing.push(value);
    values.set(key, existing);
  }
  return { values, positionals };
}

function option(parsed, name, required) {
  const values = parsed.values.get(name);
  if (!values || values.length === 0) {
    if (required) {
      fail('Missing required option --' + name + '.', 64);
    }
    return undefined;
  }
  return values[values.length - 1];
}

function options(parsed, name) {
  return (parsed.values.get(name) || []).map(String);
}

function resolveRepositoryPath(value, required) {
  if (!value) {
    if (required) {
      fail('A required path was not supplied.', 64);
    }
    return undefined;
  }
  return path.isAbsolute(value) ? value : path.resolve(repositoryRoot, value);
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail('Cannot parse JSON file ' + file + ': ' + error.message, 65);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function run(command, argumentsList, optionsValue) {
  const result = spawnSync(command, argumentsList, {
    cwd: (optionsValue && optionsValue.cwd) || repositoryRoot,
    encoding: 'utf8',
    env: (optionsValue && optionsValue.env) || process.env
  });
  if (result.error) {
    fail('Cannot execute ' + command + ': ' + result.error.message, 69);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    fail(command + ' failed (' + result.status + '): ' + (stderr || stdout || 'no diagnostic output'), result.status || 1);
  }
  return result.stdout || '';
}

function isSha40(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function requireSha40(value, label) {
  if (!isSha40(value)) {
    fail(label + ' must be a lowercase 40-character Git SHA.', 64);
  }
}

function requireSha256(value, label) {
  if (!isSha256(value)) {
    fail(label + ' must be a lowercase SHA-256 hex digest without the sha256: prefix.', 64);
  }
}

function normaliseBuild(build) {
  if (!build) {
    return undefined;
  }
  const source = typeof build === 'string' ? { context: build } : build;
  const value = {};
  for (const key of ['context', 'dockerfile', 'target', 'args', 'platforms']) {
    if (source[key] === undefined) {
      continue;
    }
    if (key === 'context' || key === 'dockerfile') {
      const resolved = path.resolve(String(source[key]));
      let relative = path.relative(repositoryRoot, resolved).replaceAll('\\', '/');
      if (!relative || relative.startsWith('../')) {
        relative = String(source[key]).replaceAll('\\', '/');
      }
      value[key] = relative;
    } else {
      value[key] = source[key];
    }
  }
  return value;
}

function parseEnvFile(file) {
  const values = new Map();
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const equals = line.indexOf('=');
    if (equals < 1) {
      fail('Invalid environment line in ' + file + '.', 65);
    }
    values.set(line.slice(0, equals).trim(), line.slice(equals + 1).trim());
  }
  return values;
}

function validateRecoveryStub(file) {
  if (!fs.existsSync(file)) {
    fail('Recovery topology stub is required and was not found: ' + file, 66);
  }
  const values = parseEnvFile(file);
  const allowed = new Set([
    'IOT_RECOVERY_TARGET_NAME',
    'IOT_RECOVERY_BASE_BACKUP',
    'WALG_STORAGE_MODE',
    'WALG_S3_PREFIX',
    'AWS_REGION',
    'AWS_ENDPOINT',
    'AWS_S3_FORCE_PATH_STYLE',
    'WALG_COMPRESSION_METHOD'
  ]);
  for (const name of values.keys()) {
    if (!allowed.has(name)) {
      fail('Recovery topology stub contains an unapproved key: ' + name, 65);
    }
  }
  const required = [
    'IOT_RECOVERY_TARGET_NAME',
    'IOT_RECOVERY_BASE_BACKUP',
    'WALG_STORAGE_MODE',
    'WALG_S3_PREFIX',
    'AWS_REGION',
    'AWS_ENDPOINT'
  ];
  for (const name of required) {
    if (!values.get(name)) {
      fail('Recovery topology stub is missing ' + name + '.', 65);
    }
  }
  const forbiddenName = /(secret|password|token|access.?key)/i;
  for (const [name, value] of values.entries()) {
    if (forbiddenName.test(name) || forbiddenName.test(value)) {
      fail('Recovery topology stub must not contain credentials or secret-like values.', 65);
    }
  }
  if (!values.get('IOT_RECOVERY_TARGET_NAME').includes('placeholder') ||
      !values.get('IOT_RECOVERY_BASE_BACKUP').includes('placeholder') ||
      !values.get('WALG_S3_PREFIX').includes('topology-placeholder') ||
      !values.get('AWS_ENDPOINT').includes('topology.invalid')) {
    fail('Recovery topology stub must contain only the approved placeholder values.', 65);
  }
}

function profileArguments(profiles) {
  const list = String(profiles || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (list.length === 0) {
    fail('At least one Compose profile must be supplied with --profiles.', 64);
  }
  const argumentsList = [];
  for (const profile of list) {
    argumentsList.push('--profile', profile);
  }
  return argumentsList;
}

function composeConfig(parameters, includeRecovery) {
  const command = ['compose'];
  command.push('--env-file', parameters.environmentFile);
  if (includeRecovery) {
    command.push('--env-file', parameters.recoveryStub);
  }
  command.push(...profileArguments(parameters.profiles));
  command.push('-f', parameters.baseCompose, '-f', parameters.runtimeCompose);
  if (includeRecovery) {
    command.push('-f', parameters.recoveryCompose);
  }
  command.push('config', '--format', 'json');
  const raw = run('docker', command);
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail('Docker Compose did not return valid JSON: ' + error.message, 65);
  }
}

function composeParameters(parsed) {
  const parameters = {
    baseCompose: resolveRepositoryPath(option(parsed, 'base-compose', true), true),
    runtimeCompose: resolveRepositoryPath(option(parsed, 'runtime-compose', true), true),
    recoveryCompose: resolveRepositoryPath(option(parsed, 'recovery-compose', true), true),
    environmentFile: resolveRepositoryPath(option(parsed, 'env', true), true),
    recoveryStub: resolveRepositoryPath(option(parsed, 'recovery-config-stub', true), true),
    profiles: option(parsed, 'profiles', true)
  };
  for (const value of Object.values(parameters)) {
    if (typeof value === 'string' && (value.endsWith('.yml') || value.endsWith('.yaml') || value.endsWith('.env')) && !fs.existsSync(value)) {
      fail('Required Compose input was not found: ' + value, 66);
    }
  }
  validateRecoveryStub(parameters.recoveryStub);
  return parameters;
}

function catalogItemForService(service) {
  const item = artifactCatalog.find((candidate) => candidate.services.includes(service));
  if (!item) {
    fail('Resolved Compose service is not in the approved release artifact catalog: ' + service, 65);
  }
  return item;
}

function orderedServiceNames(names) {
  const unknown = names.filter((name) => !serviceOrder.includes(name));
  if (unknown.length > 0) {
    fail('Resolved service(s) have no approved service identity: ' + unknown.join(', '), 65);
  }
  return [...names].sort((left, right) => serviceOrder.indexOf(left) - serviceOrder.indexOf(right));
}

function collectTopology(parameters, sourceSha) {
  const normal = composeConfig(parameters, false);
  const recovery = composeConfig(parameters, true);
  const normalServices = normal.services || {};
  const recoveryServices = recovery.services || {};
  const normalNames = orderedServiceNames(Object.keys(normalServices));
  const recoveryNames = orderedServiceNames(Object.keys(recoveryServices));
  const recoveryAddedNames = orderedServiceNames(recoveryNames.filter((name) => !normalNames.includes(name)));
  const unionNames = orderedServiceNames([...new Set([...normalNames, ...recoveryNames])]);

  if (normalNames.length !== 12 || recoveryAddedNames.length !== 1 || recoveryAddedNames[0] !== 'wal-g-recovery' || unionNames.length !== 13) {
    fail('Release topology baseline drift: expected 12 normal + wal-g-recovery + 13 union; got ' +
      normalNames.length + ' normal, ' + recoveryAddedNames.join(',') + ' added, ' + unionNames.length + ' union.', 65);
  }

  const artifacts = new Map();
  for (const serviceName of unionNames) {
    const service = recoveryServices[serviceName] || normalServices[serviceName];
    if (!service || !service.image) {
      fail('Resolved service has no image: ' + serviceName, 65);
    }
    const catalog = catalogItemForService(serviceName);
    const previous = artifacts.get(catalog.artifactId);
    const build = normaliseBuild(service.build);
    if (previous) {
      if (previous.image !== service.image) {
        fail('Artifact ' + catalog.artifactId + ' resolves to more than one image reference.', 65);
      }
      previous.services.push(serviceName);
      if (build && !previous.build) {
        previous.build = build;
      }
      continue;
    }
    artifacts.set(catalog.artifactId, {
      artifactId: catalog.artifactId,
      imageVariable: catalog.imageVariable,
      image: service.image,
      origin: build ? 'built' : 'external',
      build,
      services: [serviceName]
    });
  }

  const orderedArtifacts = artifactCatalog.map((catalog) => artifacts.get(catalog.artifactId));
  if (orderedArtifacts.some((item) => !item)) {
    fail('Resolved topology does not cover the approved eight-artifact catalog.', 65);
  }
  const buildableCount = orderedArtifacts.filter((item) => item.origin === 'built').length;
  if (orderedArtifacts.length !== 8 || buildableCount !== 6) {
    fail('Release image baseline drift: expected 8 artifacts / 6 buildable, got ' + orderedArtifacts.length + ' / ' + buildableCount + '.', 65);
  }

  const topology = {
    schemaVersion: 1,
    sourceSha: sourceSha || undefined,
    profiles: String(parameters.profiles).split(',').map((value) => value.trim()).filter(Boolean),
    expected: {
      artifacts: 8,
      buildableArtifacts: 6,
      normalRuntimeServices: 12,
      recoveryAddedServices: 1,
      releaseCandidateServices: 13
    },
    artifacts: orderedArtifacts.map((item) => ({
      artifactId: item.artifactId,
      imageVariable: item.imageVariable,
      image: item.image,
      origin: item.origin,
      build: item.build,
      services: orderedServiceNames(item.services)
    })),
    serviceMapping: unionNames.map((serviceName) => ({
      service: serviceName,
      artifactId: catalogItemForService(serviceName).artifactId
    }))
  };
  return { topology, normalNames, recoveryNames, recoveryAddedNames, unionNames };
}

function serviceRecord(name, index, serviceSet) {
  const lifecycle = serviceLifecycle[name] || 'long-running';
  return {
    serviceId: 'SVC-' + String(index + 1).padStart(2, '0'),
    service: name,
    artifactId: catalogItemForService(name).artifactId,
    serviceSet,
    lifecycle,
    requiredPhases: serviceSet === 'recovery-added' ? ['recovery'] : ['runtime']
  };
}

function buildServiceDocument(collected, topology, sourceSha) {
  const normalRuntimeServices = collected.normalNames.map((name) => serviceRecord(name, serviceOrder.indexOf(name), 'normal-runtime'));
  const recoveryServices = collected.recoveryNames.map((name) => serviceRecord(name, serviceOrder.indexOf(name), name === 'wal-g-recovery' ? 'recovery-added' : 'recovery-reused'));
  const recoveryAddedServices = collected.recoveryAddedNames.map((name) => serviceRecord(name, serviceOrder.indexOf(name), 'recovery-added'));
  const releaseCandidateUnion = collected.unionNames.map((name) => serviceRecord(name, serviceOrder.indexOf(name), name === 'wal-g-recovery' ? 'recovery-added' : 'normal-runtime'));
  return {
    schemaVersion: 1,
    sourceSha: sourceSha || undefined,
    topologyArtifactIds: topology.artifacts.map((item) => item.artifactId),
    expected: {
      normalRuntimeServices: 12,
      recoveryAddedServices: 1,
      releaseCandidateServices: 13
    },
    normalRuntimeServices,
    recoveryServices,
    recoveryAddedServices,
    releaseCandidateUnion
  };
}

function commandDiscoverImages(parsed) {
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  const sourceSha = option(parsed, 'source-sha', false) || process.env.SOURCE_SHA;
  if (sourceSha) {
    requireSha40(sourceSha, 'sourceSha');
  }
  const parameters = composeParameters(parsed);
  const collected = collectTopology(parameters, sourceSha);
  writeJson(outputFile, collected.topology);
  output(JSON.stringify({
    status: 'PASS',
    output: path.relative(repositoryRoot, outputFile).replaceAll('\\', '/'),
    artifacts: collected.topology.artifacts.length,
    buildableArtifacts: collected.topology.artifacts.filter((item) => item.origin === 'built').length,
    normalRuntimeServices: collected.normalNames.length,
    recoveryAddedServices: collected.recoveryAddedNames.length,
    releaseCandidateServices: collected.unionNames.length,
    topologySha256: sha256File(outputFile)
  }));
}

function commandDiscoverServices(parsed) {
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  const sourceSha = option(parsed, 'source-sha', false) || process.env.SOURCE_SHA;
  if (sourceSha) {
    requireSha40(sourceSha, 'sourceSha');
  }
  const parameters = composeParameters(parsed);
  const collected = collectTopology(parameters, sourceSha);
  const document = buildServiceDocument(collected, collected.topology, sourceSha);
  writeJson(outputFile, document);
  output(JSON.stringify({
    status: 'PASS',
    output: path.relative(repositoryRoot, outputFile).replaceAll('\\', '/'),
    normalRuntimeServices: document.normalRuntimeServices.length,
    recoveryAddedServices: document.recoveryAddedServices.length,
    releaseCandidateServices: document.releaseCandidateUnion.length,
    servicesSha256: sha256File(outputFile)
  }));
}

function artifactItems(document) {
  if (Array.isArray(document)) {
    return document;
  }
  for (const property of ['artifacts', 'images', 'scans', 'items']) {
    if (Array.isArray(document[property])) {
      return document[property];
    }
  }
  fail('JSON document does not contain an artifacts, images, scans, or items array.', 65);
}

function collectArtifactIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.artifactId !== 'string') {
      fail(label + ' contains an item without artifactId.', 65);
    }
    if (ids.has(item.artifactId)) {
      fail(label + ' contains duplicate artifactId ' + item.artifactId + '.', 65);
    }
    ids.add(item.artifactId);
  }
  return ids;
}

function exactSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function commandVerifyImageSet(parsed) {
  const topologyFile = resolveRepositoryPath(option(parsed, 'topology', true), true);
  const servicesFile = resolveRepositoryPath(option(parsed, 'services', true), true);
  const scansFile = resolveRepositoryPath(option(parsed, 'scans', true), true);
  const outputFile = option(parsed, 'output', false) ? resolveRepositoryPath(option(parsed, 'output', false), true) : undefined;
  const topology = readJson(topologyFile);
  const services = readJson(servicesFile);
  const scans = readJson(scansFile);
  const artifacts = artifactItems(topology);
  const scansItems = artifactItems(scans);
  const artifactIds = collectArtifactIds(artifacts, 'Topology');
  const scanIds = collectArtifactIds(scansItems, 'Scan result');
  const buildableCount = artifacts.filter((item) => item.origin === 'built').length;
  const normal = services.normalRuntimeServices || [];
  const added = services.recoveryAddedServices || [];
  const union = services.releaseCandidateUnion || [];
  const serviceArtifactIds = new Set(union.map((item) => item.artifactId));
  if (artifactIds.size !== 8 || buildableCount !== 6 || normal.length !== 12 || added.length !== 1 || union.length !== 13) {
    fail('Release image/service counts do not match the approved 8/6/12/1/13 baseline.', 65);
  }
  if (!exactSet(artifactIds, scanIds)) {
    fail('Runtime/recovery artifact set differs from scanned artifact set.', 65);
  }
  if (![...serviceArtifactIds].every((id) => artifactIds.has(id))) {
    fail('At least one release service maps to an unknown artifact.', 65);
  }
  for (const scan of scansItems) {
    if (!['PASS', 'APPROVED_VEX'].includes(String(scan.status || ''))) {
      fail('Scan result for ' + scan.artifactId + ' is not releasable: ' + String(scan.status), 65);
    }
    const digest = scan.targetDigest || scan.immutableRef || scan.digest;
    if (!digest || !String(digest).includes('sha256:')) {
      fail('Scan result for ' + scan.artifactId + ' does not identify an immutable digest.', 65);
    }
  }
  const result = {
    status: 'PASS',
    expected: { artifacts: 8, buildableArtifacts: 6, normalRuntimeServices: 12, recoveryAddedServices: 1, releaseCandidateServices: 13 },
    actual: { artifacts: artifactIds.size, buildableArtifacts: buildableCount, normalRuntimeServices: normal.length, recoveryAddedServices: added.length, releaseCandidateServices: union.length },
    topologySha256: sha256File(topologyFile),
    servicesSha256: sha256File(servicesFile),
    scansSha256: sha256File(scansFile)
  };
  if (outputFile) {
    writeJson(outputFile, result);
  }
  output(JSON.stringify(result));
}

function parseWorkflowRef(raw, label) {
  if (typeof raw !== 'string') {
    fail(label + ' raw workflow ref is missing.', 65);
  }
  const match = raw.match(/^([^/\s]+\/[^/\s]+)\/(\.github\/workflows\/[^@\s]+)@(.+)$/);
  if (!match) {
    fail(label + ' raw workflow ref cannot be parsed.', 65);
  }
  const workflowPath = '.' + match[2].slice(1);
  if (!workflowPath.startsWith('.github/workflows/') || workflowPath.includes('..')) {
    fail(label + ' workflow path is unsafe.', 65);
  }
  return { repository: match[1], workflowPath, ref: match[3] };
}

function firstValue(source, name) {
  const value = source[name];
  return value === undefined || value === null ? undefined : String(value);
}

function trustedProducerResult(fields, policy) {
  const repository = firstValue(fields, 'producerRepository');
  if (!repository || repository !== policy.approvedRepository) {
    return 'UNTRUSTED_REPOSITORY';
  }
  if (!policy.allowedEvents.includes(firstValue(fields, 'producerEvent'))) {
    return 'UNTRUSTED_EVENT';
  }
  if (!policy.allowedModes.includes(firstValue(fields, 'invocationMode'))) {
    return 'UNTRUSTED_EVENT';
  }
  let producerRaw;
  try {
    producerRaw = parseWorkflowRef(firstValue(fields, 'producerWorkflowRefRaw'), 'Producer');
  } catch (_) {
    return 'UNAPPROVED_WORKFLOW_PATH';
  }
  if (producerRaw.repository !== repository ||
      producerRaw.workflowPath !== firstValue(fields, 'producerWorkflowPath') ||
      !policy.producerPaths.includes(producerRaw.workflowPath)) {
    return 'UNAPPROVED_WORKFLOW_PATH';
  }
  const producerSha = firstValue(fields, 'producerWorkflowSha');
  if (!isSha40(producerSha)) {
    return 'INVALID_WORKFLOW_SHA';
  }
  const recomputedProducerIdentity = repository + '/' + producerRaw.workflowPath + '@' + producerSha;
  if (firstValue(fields, 'producerWorkflowIdentity') !== recomputedProducerIdentity) {
    return 'WORKFLOW_IDENTITY_MISMATCH';
  }
  const producerAllowed = policy.producerIdentities.length > 0
    ? policy.producerIdentities.includes(recomputedProducerIdentity)
    : producerSha === policy.sourceSha;
  if (!producerAllowed) {
    return 'WORKFLOW_IDENTITY_MISMATCH';
  }
  const callerFieldsPresent = ['callerWorkflowRefRaw', 'callerWorkflowSha', 'callerWorkflowPath', 'callerWorkflowIdentity']
    .some((name) => firstValue(fields, name));
  if (callerFieldsPresent) {
    let callerRaw;
    try {
      callerRaw = parseWorkflowRef(firstValue(fields, 'callerWorkflowRefRaw'), 'Caller');
    } catch (_) {
      return 'CALLER_IDENTITY_MISMATCH';
    }
    const callerSha = firstValue(fields, 'callerWorkflowSha');
    if (!isSha40(callerSha)) {
      return 'INVALID_WORKFLOW_SHA';
    }
    const callerRepository = firstValue(fields, 'callerRepository') || repository;
    const recomputedCallerIdentity = callerRepository + '/' + callerRaw.workflowPath + '@' + callerSha;
    if (callerRaw.repository !== callerRepository ||
        callerRaw.workflowPath !== firstValue(fields, 'callerWorkflowPath') ||
        firstValue(fields, 'callerWorkflowIdentity') !== recomputedCallerIdentity ||
        !policy.callerPaths.includes(callerRaw.workflowPath)) {
      return 'CALLER_IDENTITY_MISMATCH';
    }
    const callerAllowed = policy.callerIdentities.length > 0
      ? policy.callerIdentities.includes(recomputedCallerIdentity)
      : callerSha === policy.sourceSha;
    if (!callerAllowed) {
      return 'CALLER_IDENTITY_MISMATCH';
    }
  }
  if (!/^[0-9]+$/.test(firstValue(fields, 'producerRunId') || '') ||
      !/^[0-9]+$/.test(firstValue(fields, 'producerRunAttempt') || '') ||
      !firstValue(fields, 'producerJob')) {
    return 'RUN_MISMATCH';
  }
  const artifactSha = firstValue(fields, 'artifactSha256');
  if (!isSha256(artifactSha)) {
    return 'ARTIFACT_HASH_MISMATCH';
  }
  if (firstValue(fields, 'sourceSha') !== policy.sourceSha || !isSha40(firstValue(fields, 'sourceSha'))) {
    return 'RUN_MISMATCH';
  }
  return 'TRUSTED';
}

function policyFromParsed(parsed) {
  const sourceSha = option(parsed, 'source-sha', true);
  requireSha40(sourceSha, 'sourceSha');
  const approvedRepository = option(parsed, 'approved-repository', false) || process.env.GITHUB_REPOSITORY;
  if (!approvedRepository || !/^[^/\s]+\/[^/\s]+$/.test(approvedRepository)) {
    fail('--approved-repository must be supplied as owner/repository.', 64);
  }
  const producerPaths = options(parsed, 'approved-producer-path');
  const callerPaths = options(parsed, 'approved-caller-path');
  if (producerPaths.length === 0 || callerPaths.length === 0) {
    fail('At least one approved producer and caller workflow path is required.', 64);
  }
  return {
    sourceSha,
    approvedRepository,
    producerPaths,
    callerPaths,
    producerIdentities: options(parsed, 'approved-producer-identity'),
    callerIdentities: options(parsed, 'approved-caller-identity'),
    allowedEvents: options(parsed, 'allowed-event').length > 0 ? options(parsed, 'allowed-event') : ['push', 'workflow_dispatch', 'workflow_call'],
    allowedModes: options(parsed, 'allowed-invocation-mode').length > 0 ? options(parsed, 'allowed-invocation-mode') : ['orchestrated-reusable', 'protected-fallback-dispatch']
  };
}

function fieldsFromParsed(parsed) {
  const input = option(parsed, 'input', false);
  if (input) {
    return readJson(resolveRepositoryPath(input, true));
  }
  const mapping = [
    'producerRepository', 'producerEvent', 'invocationMode',
    'callerRepository', 'callerWorkflowRefRaw', 'callerWorkflowSha', 'callerWorkflowPath', 'callerWorkflowIdentity',
    'producerRunId', 'producerRunAttempt', 'producerWorkflowRefRaw', 'producerWorkflowSha', 'producerWorkflowPath',
    'producerWorkflowIdentity', 'producerJob', 'artifactSha256', 'releaseCandidateId', 'sourceSha'
  ];
  const fields = {};
  for (const name of mapping) {
    const kebab = name.replace(/[A-Z]/g, (character) => '-' + character.toLowerCase());
    const value = option(parsed, kebab, false);
    if (value !== undefined) {
      fields[name] = value;
    }
  }
  return fields;
}

function commandValidateTrustedProducer(parsed) {
  const fields = fieldsFromParsed(parsed);
  const policy = policyFromParsed(parsed);
  const result = trustedProducerResult(fields, policy);
  output(result);
  if (result !== 'TRUSTED') {
    process.exitCode = 1;
  }
}

function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    fail('Candidate document must be an object.', 65);
  }
  if (!/^r1-rc[._-].+-[0-9a-f]{12}$/.test(String(candidate.releaseCandidateId || ''))) {
    fail('Candidate releaseCandidateId is invalid.', 65);
  }
  requireSha40(candidate.sourceSha, 'Candidate sourceSha');
  requireSha256(candidate.topologySha256, 'Candidate topologySha256');
}

function validateStage(stage, candidate, expectedStage) {
  if (!stage || typeof stage !== 'object') {
    fail('Stage document must be an object.', 65);
  }
  for (const field of [
    'releaseCandidateId', 'sourceSha', 'topologySha256', 'manifestSha256',
    'callerRepository', 'callerWorkflowRefRaw', 'callerWorkflowSha', 'callerWorkflowPath', 'callerWorkflowIdentity',
    'producerWorkflowSha', 'producerWorkflowIdentity', 'producerRunId', 'orchestratorRunId', 'runnerClass', 'stage'
  ]) {
    if (!stage[field]) {
      fail('Stage document is missing ' + field + '.', 65);
    }
  }
  if (stage.releaseCandidateId !== candidate.releaseCandidateId ||
      stage.sourceSha !== candidate.sourceSha ||
      stage.topologySha256 !== candidate.topologySha256) {
    fail('Stage document does not belong to the supplied release candidate.', 65);
  }
  requireSha40(stage.producerWorkflowSha, 'Stage producerWorkflowSha');
  requireSha40(stage.callerWorkflowSha, 'Stage callerWorkflowSha');
  requireSha256(stage.manifestSha256, 'Stage manifestSha256');
  if (!['github-hosted', 'larger-runner', 'self-hosted-ephemeral'].includes(stage.runnerClass)) {
    fail('Stage runnerClass is invalid.', 65);
  }
  if (expectedStage && stage.stage !== expectedStage) {
    fail('Expected stage ' + expectedStage + ' but received ' + stage.stage + '.', 65);
  }
  if (stage.checkoutVerified !== true || stage.requestedSourceSha !== candidate.sourceSha || stage.checkedOutSourceSha !== candidate.sourceSha) {
    fail('Stage has not recorded a verified exact source checkout.', 65);
  }
  const callerParsed = parseWorkflowRef(stage.callerWorkflowRefRaw, 'Stage caller');
  if (callerParsed.repository !== stage.callerRepository ||
      callerParsed.workflowPath !== stage.callerWorkflowPath ||
      stage.callerWorkflowIdentity !== stage.callerRepository + '/' + callerParsed.workflowPath + '@' + stage.callerWorkflowSha) {
    fail('Stage caller workflow identity fields are internally inconsistent.', 65);
  }
}

function commandValidateReleaseCandidate(parsed) {
  const candidate = readJson(resolveRepositoryPath(option(parsed, 'candidate', true), true));
  const stage = readJson(resolveRepositoryPath(option(parsed, 'stage', true), true));
  validateCandidate(candidate);
  validateStage(stage, candidate, option(parsed, 'expected-stage', false));
  output('PASS');
}

function parseExpectedHash(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  const match = text.match(/^([0-9a-f]{64})(?:\s+\*?.*)?$/);
  if (!match) {
    fail('Checksum file is invalid: ' + file, 65);
  }
  return match[1];
}

function commandValidateStageHandoff(parsed) {
  const candidate = readJson(resolveRepositoryPath(option(parsed, 'candidate', true), true));
  const stageFile = resolveRepositoryPath(option(parsed, 'stage', true), true);
  const stage = readJson(stageFile);
  validateCandidate(candidate);
  validateStage(stage, candidate, option(parsed, 'expected-stage', false));
  const artifactFile = resolveRepositoryPath(option(parsed, 'artifact', true), true);
  const checksumFile = resolveRepositoryPath(option(parsed, 'artifact-sha256', true), true);
  const actualHash = sha256File(artifactFile);
  const expectedHash = parseExpectedHash(checksumFile);
  if (actualHash !== expectedHash || stage.artifactSha256 !== actualHash) {
    fail('ARTIFACT_HASH_MISMATCH', 65);
  }
  const exactFields = [
    ['producer-run-id', 'producerRunId'],
    ['producer-run-attempt', 'producerRunAttempt'],
    ['producer-job', 'producerJob'],
    ['artifact-name', 'artifactName']
  ];
  for (const [argumentName, fieldName] of exactFields) {
    const expected = option(parsed, argumentName, false);
    if (expected !== undefined && String(stage[fieldName]) !== String(expected)) {
      fail('RUN_MISMATCH', 65);
    }
  }
  const fields = { ...stage, artifactSha256: actualHash };
  const result = trustedProducerResult(fields, policyFromParsed(parsed));
  if (result !== 'TRUSTED') {
    fail(result, 65);
  }
  output('PASS');
}

function immutableReference(item) {
  const existing = item.immutableRef || item.targetDigest || item.reference;
  if (existing && String(existing).includes('@sha256:')) {
    return String(existing);
  }
  const image = item.image || item.registryRef || item.repository;
  const digest = item.digest;
  if (!image || !digest) {
    fail('Digest manifest item ' + String(item.artifactId) + ' lacks an immutable reference.', 65);
  }
  const digestText = String(digest).startsWith('sha256:') ? String(digest) : 'sha256:' + String(digest);
  if (!/^sha256:[0-9a-f]{64}$/.test(digestText)) {
    fail('Digest manifest item ' + String(item.artifactId) + ' has an invalid digest.', 65);
  }
  return String(image).split('@')[0] + '@' + digestText;
}

function digestItems(document) {
  const items = artifactItems(document);
  const byId = new Map();
  for (const item of items) {
    const reference = immutableReference(item);
    if (byId.has(item.artifactId)) {
      fail('Digest manifest contains duplicate artifact ' + item.artifactId + '.', 65);
    }
    byId.set(item.artifactId, reference);
  }
  if (byId.size !== 8 || !artifactCatalog.every((item) => byId.has(item.artifactId))) {
    fail('Digest manifest must contain exactly the approved eight artifacts.', 65);
  }
  return byId;
}

function commandRenderDigestEnvironment(parsed) {
  const manifestFile = resolveRepositoryPath(option(parsed, 'manifest', true), true);
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  const manifest = readJson(manifestFile);
  const byId = digestItems(manifest);
  const lines = artifactCatalog.map((item) => item.imageVariable + '=' + byId.get(item.artifactId));
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, lines.join('\n') + '\n', 'utf8');
  output(JSON.stringify({ status: 'PASS', output: path.relative(repositoryRoot, outputFile).replaceAll('\\', '/'), manifestSha256: sha256File(manifestFile) }));
}

function commandValidateDigestManifest(parsed) {
  const candidateFile = resolveRepositoryPath(option(parsed, 'candidate', true), true);
  const topologyFile = resolveRepositoryPath(option(parsed, 'topology', true), true);
  const servicesFile = resolveRepositoryPath(option(parsed, 'services', true), true);
  const manifestFile = resolveRepositoryPath(option(parsed, 'manifest', true), true);
  const candidate = readJson(candidateFile);
  const topology = readJson(topologyFile);
  const services = readJson(servicesFile);
  const manifest = readJson(manifestFile);
  validateCandidate(candidate);
  const manifestSha256 = sha256File(manifestFile);
  const expectedManifestSha256 = option(parsed, 'expected-manifest-sha256', false);
  const expectedCandidateId = option(parsed, 'expected-release-candidate-id', false);
  const expectedSourceSha = option(parsed, 'expected-source-sha', false);

  if (sha256File(topologyFile) !== candidate.topologySha256 || sha256File(servicesFile) !== candidate.servicesSha256) {
    fail('Candidate topology/services checksums do not match the supplied release topology documents.', 65);
  }
  if (manifest.releaseCandidateId !== candidate.releaseCandidateId ||
      manifest.sourceSha !== candidate.sourceSha ||
      manifest.topologySha256 !== candidate.topologySha256) {
    fail('Digest manifest does not belong to the supplied release candidate.', 65);
  }
  if (expectedManifestSha256) {
    requireSha256(expectedManifestSha256, 'expected manifest SHA-256');
    if (manifestSha256 !== expectedManifestSha256) {
      fail('Digest manifest SHA-256 does not match the expected frozen manifest SHA-256.', 65);
    }
  }
  if (expectedCandidateId && expectedCandidateId !== candidate.releaseCandidateId) {
    fail('Release candidate ID does not match the expected immutable candidate.', 65);
  }
  if (expectedSourceSha) {
    requireSha40(expectedSourceSha, 'expected source SHA');
    if (expectedSourceSha !== candidate.sourceSha) {
      fail('Candidate sourceSha does not match the expected immutable source SHA.', 65);
    }
  }

  const artifacts = artifactItems(topology);
  const manifestArtifacts = digestItems(manifest);
  const normal = services.normalRuntimeServices || [];
  const recoveryAdded = services.recoveryAddedServices || [];
  const union = services.releaseCandidateUnion || [];
  if (artifacts.length !== 8 || artifacts.filter((item) => item.origin === 'built').length !== 6 ||
      normal.length !== 12 || recoveryAdded.length !== 1 || union.length !== 13) {
    fail('Release topology does not match the approved 8/6/12/1/13 baseline.', 65);
  }
  const serviceArtifactIds = new Set(union.map((item) => item.artifactId));
  if (![...serviceArtifactIds].every((artifactId) => manifestArtifacts.has(artifactId))) {
    fail('A release service maps to an artifact absent from the immutable digest manifest.', 65);
  }
  output(JSON.stringify({
    status: 'PASS',
    releaseCandidateId: candidate.releaseCandidateId,
    sourceSha: candidate.sourceSha,
    topologySha256: candidate.topologySha256,
    manifestSha256,
    artifacts: manifestArtifacts.size,
    normalRuntimeServices: normal.length,
    recoveryAddedServices: recoveryAdded.length,
    releaseCandidateServices: union.length
  }));
}

function findDigestValue(value) {
  if (typeof value === 'string') {
    const digest = extractDigest(value);
    return digest;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key.toLowerCase().includes('digest')) {
      const digest = findDigestValue(child);
      if (digest) {
        return digest;
      }
    }
  }
  return undefined;
}

function releaseExecutionMetadata(parsed, candidate) {
  const checkedOutSourceSha = option(parsed, 'checked-out-source-sha', false);
  const producerWorkflowRefRaw = option(parsed, 'producer-workflow-ref-raw', false);
  const producerWorkflowSha = option(parsed, 'producer-workflow-sha', false);
  const producerRepository = option(parsed, 'producer-repository', false);
  const producerRunId = option(parsed, 'producer-run-id', false);
  const producerRunAttempt = option(parsed, 'producer-run-attempt', false);
  const producerJob = option(parsed, 'producer-job', false);
  const runnerClass = option(parsed, 'runner-class', false);
  const producerEvent = option(parsed, 'producer-event', false);
  const invocationMode = option(parsed, 'invocation-mode', false);
  const supplied = [checkedOutSourceSha, producerWorkflowRefRaw, producerWorkflowSha, producerRepository, producerRunId, producerRunAttempt, producerJob, runnerClass, producerEvent, invocationMode]
    .some((value) => value !== undefined);
  if (!supplied) {
    return {};
  }
  requireSha40(checkedOutSourceSha, 'checkedOutSourceSha');
  if (checkedOutSourceSha !== candidate.sourceSha) {
    fail('Build/scan metadata checkout SHA differs from the release candidate sourceSha.', 65);
  }
  if (!producerRepository || !producerWorkflowRefRaw || !producerWorkflowSha || !producerRunId || !producerRunAttempt || !producerJob || !runnerClass || !producerEvent || !invocationMode) {
    fail('Build/scan metadata must include complete producer, checkout, runner, and invocation fields.', 64);
  }
  requireSha40(producerWorkflowSha, 'producerWorkflowSha');
  const producerParsed = parseWorkflowRef(producerWorkflowRefRaw, 'Producer');
  if (producerParsed.repository !== producerRepository) {
    fail('Producer raw workflow ref repository does not match producerRepository.', 65);
  }
  if (!/^[0-9]+$/.test(String(producerRunId)) || !/^[0-9]+$/.test(String(producerRunAttempt))) {
    fail('Producer run ID and attempt must be decimal numbers.', 64);
  }
  if (!['github-hosted', 'larger-runner', 'self-hosted-ephemeral'].includes(runnerClass)) {
    fail('runnerClass is invalid.', 64);
  }
  const metadata = {
    requestedSourceSha: candidate.sourceSha,
    checkedOutSourceSha,
    checkoutVerified: true,
    producerRepository,
    producerEvent,
    invocationMode,
    producerRunId: String(producerRunId),
    producerRunAttempt: Number(producerRunAttempt),
    producerWorkflowRefRaw,
    producerWorkflowSha,
    producerWorkflowPath: producerParsed.workflowPath,
    producerWorkflowIdentity: producerRepository + '/' + producerParsed.workflowPath + '@' + producerWorkflowSha,
    producerJob,
    runnerClass
  };
  const callerWorkflowRefRaw = option(parsed, 'caller-workflow-ref-raw', false);
  const callerWorkflowSha = option(parsed, 'caller-workflow-sha', false);
  const callerRepository = option(parsed, 'caller-repository', false) || producerRepository;
  const callerPresent = [callerWorkflowRefRaw, callerWorkflowSha, option(parsed, 'caller-workflow-path', false), option(parsed, 'caller-workflow-identity', false)]
    .some((value) => value !== undefined);
  if (callerPresent) {
    if (!callerWorkflowRefRaw || !callerWorkflowSha) {
      fail('Caller workflow metadata must be complete when supplied.', 64);
    }
    requireSha40(callerWorkflowSha, 'callerWorkflowSha');
    const callerParsed = parseWorkflowRef(callerWorkflowRefRaw, 'Caller');
    if (callerParsed.repository !== callerRepository) {
      fail('Caller raw workflow ref repository does not match callerRepository.', 65);
    }
    metadata.callerRepository = callerRepository;
    metadata.callerWorkflowRefRaw = callerWorkflowRefRaw;
    metadata.callerWorkflowSha = callerWorkflowSha;
    metadata.callerWorkflowPath = callerParsed.workflowPath;
    metadata.callerWorkflowIdentity = callerRepository + '/' + callerParsed.workflowPath + '@' + callerWorkflowSha;
  }
  return metadata;
}

function validateReleaseExecutionMetadata(document, candidate, label) {
  const required = [
    'requestedSourceSha', 'checkedOutSourceSha', 'checkoutVerified',
    'producerRepository', 'producerEvent', 'invocationMode',
    'producerRunId', 'producerRunAttempt', 'producerWorkflowRefRaw',
    'producerWorkflowSha', 'producerWorkflowPath', 'producerWorkflowIdentity',
    'producerJob', 'runnerClass'
  ];
  for (const field of required) {
    if (document[field] === undefined || document[field] === null || document[field] === '') {
      fail(label + ' is missing required execution metadata field ' + field + '.', 65);
    }
  }
  if (document.requestedSourceSha !== candidate.sourceSha ||
      document.checkedOutSourceSha !== candidate.sourceSha ||
      document.checkoutVerified !== true) {
    fail(label + ' does not prove exact checkout of the candidate source SHA.', 65);
  }
  requireSha40(document.producerWorkflowSha, label + ' producerWorkflowSha');
  const producer = parseWorkflowRef(document.producerWorkflowRefRaw, label + ' producer');
  if (producer.repository !== document.producerRepository ||
      producer.workflowPath !== document.producerWorkflowPath ||
      document.producerWorkflowIdentity !== document.producerRepository + '/' + producer.workflowPath + '@' + document.producerWorkflowSha) {
    fail(label + ' producer workflow identity is internally inconsistent.', 65);
  }
  if (!/^[0-9]+$/.test(String(document.producerRunId)) ||
      !/^[0-9]+$/.test(String(document.producerRunAttempt)) ||
      !['github-hosted', 'larger-runner', 'self-hosted-ephemeral'].includes(document.runnerClass)) {
    fail(label + ' producer run or runner metadata is invalid.', 65);
  }
}

function commandBuildImage(parsed) {
  const artifactId = option(parsed, 'artifact-id', true);
  const targetByArtifact = {
    'IMG-R01': 'backend',
    'IMG-R02': 'caddy',
    'IMG-R03': 'keycloak',
    'IMG-R04': 'postgres',
    'IMG-R05': 'prometheus',
    'IMG-R06': 'alertmanager'
  };
  const repositoryByArtifact = {
    'IMG-R01': 'iot-manager-backend',
    'IMG-R02': 'iot-manager-caddy',
    'IMG-R03': 'iot-manager-keycloak',
    'IMG-R04': 'iot-manager-postgres',
    'IMG-R05': 'iot-manager-prometheus',
    'IMG-R06': 'iot-manager-alertmanager'
  };
  if (!targetByArtifact[artifactId]) {
    fail('Only buildable artifacts IMG-R01 through IMG-R06 can be built.', 64);
  }
  const candidate = readJson(resolveRepositoryPath(option(parsed, 'candidate', true), true));
  const topologyFile = resolveRepositoryPath(option(parsed, 'topology', true), true);
  const topology = readJson(topologyFile);
  validateCandidate(candidate);
  const executionMetadata = releaseExecutionMetadata(parsed, candidate);
  if (sha256File(topologyFile) !== candidate.topologySha256) {
    fail('Candidate topologySha256 does not match the supplied topology file.', 65);
  }
  const topologyArtifact = artifactItems(topology).find((item) => item.artifactId === artifactId);
  if (!topologyArtifact || topologyArtifact.origin !== 'built') {
    fail('Requested artifact is not a buildable release artifact: ' + artifactId, 65);
  }
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  const metadataFile = outputFile + '.buildx-metadata.json';
  const registry = option(parsed, 'registry', true).replace(/\/+$/, '');
  const tag = option(parsed, 'tag', true);
  const platform = option(parsed, 'platform', false) || 'linux/amd64';
  const cacheScope = option(parsed, 'cache-scope', false);
  const push = option(parsed, 'push', false) === true || option(parsed, 'push', false) === 'true';
  const target = targetByArtifact[artifactId];
  const registryRef = registry + '/' + repositoryByArtifact[artifactId] + ':' + tag;
  const bakeArguments = [
    'buildx', 'bake', '-f', 'deploy/docker-bake.hcl', target,
    '--set', target + '.tags=' + registryRef,
    '--set', target + '.platforms=' + platform,
    '--metadata-file', metadataFile
  ];
  if (cacheScope) {
    bakeArguments.push('--set', target + '.cache-from=type=gha,scope=' + cacheScope);
    bakeArguments.push('--set', target + '.cache-to=type=gha,mode=max,scope=' + cacheScope);
  }
  bakeArguments.push(push ? '--push' : '--load');
  const started = Date.now();
  run('docker', bakeArguments);
  let digest;
  if (fs.existsSync(metadataFile)) {
    digest = findDigestValue(readJson(metadataFile));
  }
  if (push && !digest) {
    const resolved = run('docker', ['buildx', 'imagetools', 'inspect', registryRef, '--format', '{{json .Manifest.Digest}}']).trim();
    digest = extractDigest(resolved);
  }
  if (push && !digest) {
    fail('Buildx push completed without a resolvable immutable image digest.', 65);
  }
  const result = {
    schemaVersion: 1,
    releaseCandidateId: candidate.releaseCandidateId,
    sourceSha: candidate.sourceSha,
    topologySha256: candidate.topologySha256,
    artifactId,
    origin: 'built',
    registryRef,
    digest,
    immutableRef: digest ? registryRef + '@' + digest : undefined,
    cacheScope: cacheScope || undefined,
    buildDurationSeconds: Math.round((Date.now() - started) / 1000),
    buildMetadataFile: path.basename(metadataFile),
    buildMetadataSha256: fs.existsSync(metadataFile) ? sha256File(metadataFile) : undefined,
    status: push ? 'PASS' : 'EXPECTED_SKIP'
  };
  Object.assign(result, executionMetadata);
  writeJson(outputFile, result);
  fs.writeFileSync(outputFile + '.sha256', sha256File(outputFile) + '  ' + path.basename(outputFile) + '\n', 'utf8');
  output(JSON.stringify({ status: result.status, artifactId, registryRef, digest, output: path.relative(repositoryRoot, outputFile).replaceAll('\\', '/') }));
}

function commandAssembleImageManifest(parsed) {
  const candidate = readJson(resolveRepositoryPath(option(parsed, 'candidate', true), true));
  const topologyFile = resolveRepositoryPath(option(parsed, 'topology', true), true);
  const topology = readJson(topologyFile);
  const resultsDirectory = resolveRepositoryPath(option(parsed, 'build-results-dir', true), true);
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  validateCandidate(candidate);
  if (sha256File(topologyFile) !== candidate.topologySha256) {
    fail('Candidate topologySha256 does not match the supplied topology file.', 65);
  }
  const results = new Map();
  if (!fs.existsSync(resultsDirectory)) {
    fail('Build result directory was not found: ' + resultsDirectory, 66);
  }
  for (const entry of fs.readdirSync(resultsDirectory)) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    const file = path.join(resultsDirectory, entry);
    const result = readJson(file);
    if (!result.artifactId) {
      continue;
    }
    const checksumFile = file + '.sha256';
    if (!fs.existsSync(checksumFile) || parseExpectedHash(checksumFile) !== sha256File(file)) {
      fail('Build result checksum is missing or invalid for ' + result.artifactId + '.', 65);
    }
    validateReleaseExecutionMetadata(result, candidate, 'Build result ' + result.artifactId);
    if (results.has(result.artifactId)) {
      fail('Build result directory has duplicate result for ' + result.artifactId + '.', 65);
    }
    results.set(result.artifactId, { ...result, resultSha256: sha256File(file) });
  }
  const artifacts = [];
  for (const topologyArtifact of artifactItems(topology)) {
    if (topologyArtifact.origin === 'external') {
      if (!String(topologyArtifact.image).includes('@sha256:')) {
        fail('External artifact must already be pinned by digest: ' + topologyArtifact.artifactId, 65);
      }
      artifacts.push({
        artifactId: topologyArtifact.artifactId,
        origin: 'external',
        image: topologyArtifact.image,
        immutableRef: topologyArtifact.image
      });
      continue;
    }
    const result = results.get(topologyArtifact.artifactId);
    if (!result ||
        result.status !== 'PASS' ||
        result.releaseCandidateId !== candidate.releaseCandidateId ||
        result.sourceSha !== candidate.sourceSha ||
        result.topologySha256 !== candidate.topologySha256 ||
        !result.immutableRef ||
        !String(result.immutableRef).includes('@sha256:')) {
      fail('Missing or invalid immutable build result for ' + topologyArtifact.artifactId + '.', 65);
    }
    artifacts.push({
      artifactId: topologyArtifact.artifactId,
      origin: 'built',
      image: result.registryRef,
      digest: result.digest,
      immutableRef: result.immutableRef,
      buildResultSha256: result.resultSha256
    });
  }
  const manifest = {
    schemaVersion: 1,
    releaseCandidateId: candidate.releaseCandidateId,
    sourceSha: candidate.sourceSha,
    topologySha256: candidate.topologySha256,
    artifacts
  };
  writeJson(outputFile, manifest);
  fs.writeFileSync(outputFile + '.sha256', sha256File(outputFile) + '  ' + path.basename(outputFile) + '\n', 'utf8');
  output(JSON.stringify({ status: 'PASS', output: path.relative(repositoryRoot, outputFile).replaceAll('\\', '/'), manifestSha256: sha256File(outputFile), artifacts: artifacts.length }));
}

function trivyCounts(report) {
  let high = 0;
  let critical = 0;
  for (const result of report.Results || []) {
    for (const vulnerability of result.Vulnerabilities || []) {
      if (vulnerability.Severity === 'HIGH') {
        high += 1;
      } else if (vulnerability.Severity === 'CRITICAL') {
        critical += 1;
      }
    }
  }
  return { high, critical };
}

function trivyBlockingCves(report) {
  const cves = new Set();
  for (const result of report.Results || []) {
    for (const vulnerability of result.Vulnerabilities || []) {
      if ((vulnerability.Severity === 'HIGH' || vulnerability.Severity === 'CRITICAL') && vulnerability.VulnerabilityID) {
        cves.add(String(vulnerability.VulnerabilityID));
      }
    }
  }
  return [...cves].sort();
}

function commandCreateImageScanResult(parsed) {
  const candidate = readJson(resolveRepositoryPath(option(parsed, 'candidate', true), true));
  const manifestFile = resolveRepositoryPath(option(parsed, 'manifest', true), true);
  const manifest = readJson(manifestFile);
  const artifactId = option(parsed, 'artifact-id', true);
  const reportFile = resolveRepositoryPath(option(parsed, 'report', true), true);
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  const exitCode = Number(option(parsed, 'scanner-exit-code', true));
  validateCandidate(candidate);
  const executionMetadata = releaseExecutionMetadata(parsed, candidate);
  const manifestById = digestItems(manifest);
  if (!manifestById.has(artifactId)) {
    fail('Scan result references an artifact absent from the digest manifest: ' + artifactId, 65);
  }
  if (manifest.releaseCandidateId !== candidate.releaseCandidateId ||
      manifest.sourceSha !== candidate.sourceSha ||
      manifest.topologySha256 !== candidate.topologySha256) {
    fail('Digest manifest does not belong to the supplied candidate.', 65);
  }
  const report = readJson(reportFile);
  const counts = trivyCounts(report);
  const manifestArtifact = artifactItems(manifest).find((item) => item.artifactId === artifactId);
  const blockingCves = trivyBlockingCves(report);
  const vexDirectoryOption = option(parsed, 'vex-dir', false);
  const vexDirectory = vexDirectoryOption ? resolveRepositoryPath(vexDirectoryOption, true) : undefined;
  const validVexCves = vexDirectory
    ? blockingCves.filter((cve) => hasApprovedVex(vexDirectory, artifactId, manifestById.get(artifactId), cve))
    : [];
  const allBlockingCvesApproved = blockingCves.length > 0 && validVexCves.length === blockingCves.length;
  const status = exitCode !== 0
    ? 'FAIL'
    : blockingCves.length === 0
      ? 'PASS'
      : allBlockingCvesApproved
        ? 'APPROVED_VEX'
        : 'FAIL';
  const result = {
    schemaVersion: 1,
    releaseCandidateId: candidate.releaseCandidateId,
    sourceSha: candidate.sourceSha,
    topologySha256: candidate.topologySha256,
    manifestSha256: sha256File(manifestFile),
    artifactId,
    origin: manifestArtifact && manifestArtifact.origin,
    targetDigest: manifestById.get(artifactId),
    reportSha256: sha256File(reportFile),
    trivyVersion: option(parsed, 'trivy-version', false),
    trivyDbMetadata: option(parsed, 'trivy-db-metadata', false),
    high: counts.high,
    critical: counts.critical,
    blockingCves,
    validVexCves,
    vexResult: blockingCves.length === 0 ? 'NOT_REQUIRED' : allBlockingCvesApproved ? 'APPROVED_VEX' : 'NO_VALID_VEX',
    scannerExitCode: exitCode,
    status
  };
  Object.assign(result, executionMetadata);
  writeJson(outputFile, result);
  fs.writeFileSync(outputFile + '.sha256', sha256File(outputFile) + '  ' + path.basename(outputFile) + '\n', 'utf8');
  output(JSON.stringify({ status, artifactId, high: counts.high, critical: counts.critical, output: path.relative(repositoryRoot, outputFile).replaceAll('\\', '/') }));
  if (!['PASS', 'APPROVED_VEX'].includes(status)) {
    process.exitCode = 1;
  }
}

function commandAssembleImageScans(parsed) {
  const candidate = readJson(resolveRepositoryPath(option(parsed, 'candidate', true), true));
  const manifestFile = resolveRepositoryPath(option(parsed, 'manifest', true), true);
  const manifest = readJson(manifestFile);
  const resultsDirectory = resolveRepositoryPath(option(parsed, 'scan-results-dir', true), true);
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  validateCandidate(candidate);
  const manifestById = digestItems(manifest);
  const results = [];
  for (const entry of fs.readdirSync(resultsDirectory)) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    const item = readJson(path.join(resultsDirectory, entry));
    if (item.artifactId) {
      const resultFile = path.join(resultsDirectory, entry);
      const checksumFile = resultFile + '.sha256';
      if (!fs.existsSync(checksumFile) || parseExpectedHash(checksumFile) !== sha256File(resultFile)) {
        fail('Image scan result checksum is missing or invalid for ' + item.artifactId + '.', 65);
      }
      validateReleaseExecutionMetadata(item, candidate, 'Image scan result ' + item.artifactId);
      results.push(item);
    }
  }
  const ids = collectArtifactIds(results, 'Image scan results');
  if (!exactSet(ids, new Set(manifestById.keys()))) {
    fail('Image scan results do not cover the exact immutable manifest artifact set.', 65);
  }
  let passed = true;
  for (const result of results) {
    if (result.releaseCandidateId !== candidate.releaseCandidateId ||
        result.sourceSha !== candidate.sourceSha ||
        result.topologySha256 !== candidate.topologySha256 ||
        result.manifestSha256 !== sha256File(manifestFile) ||
        result.targetDigest !== manifestById.get(result.artifactId) ||
        !['PASS', 'APPROVED_VEX'].includes(result.status)) {
      passed = false;
    }
  }
  const summary = {
    schemaVersion: 1,
    releaseCandidateId: candidate.releaseCandidateId,
    sourceSha: candidate.sourceSha,
    topologySha256: candidate.topologySha256,
    manifestSha256: sha256File(manifestFile),
    images: results.sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    status: passed ? 'PASS' : 'FAIL'
  };
  writeJson(outputFile, summary);
  fs.writeFileSync(outputFile + '.sha256', sha256File(outputFile) + '  ' + path.basename(outputFile) + '\n', 'utf8');
  output(JSON.stringify({ status: summary.status, images: results.length, output: path.relative(repositoryRoot, outputFile).replaceAll('\\', '/') }));
  if (!passed) {
    process.exitCode = 1;
  }
}

function commandWriteStageResult(parsed) {
  const candidate = readJson(resolveRepositoryPath(option(parsed, 'candidate', true), true));
  const manifestFile = resolveRepositoryPath(option(parsed, 'manifest', true), true);
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  const stageName = option(parsed, 'stage', true);
  const checkedOutSourceSha = option(parsed, 'checked-out-source-sha', true);
  const producerRepository = option(parsed, 'producer-repository', true);
  const producerWorkflowRefRaw = option(parsed, 'producer-workflow-ref-raw', true);
  const producerWorkflowSha = option(parsed, 'producer-workflow-sha', true);
  const producerRunId = option(parsed, 'producer-run-id', true);
  const producerRunAttempt = option(parsed, 'producer-run-attempt', true);
  const producerJob = option(parsed, 'producer-job', true);
  const artifactName = option(parsed, 'artifact-name', true);
  validateCandidate(candidate);
  requireSha40(checkedOutSourceSha, 'checkedOutSourceSha');
  requireSha40(producerWorkflowSha, 'producerWorkflowSha');
  if (checkedOutSourceSha !== candidate.sourceSha) {
    fail('A stage result cannot claim a checkout different from its candidate sourceSha.', 65);
  }
  const producerParsed = parseWorkflowRef(producerWorkflowRefRaw, 'Producer');
  if (producerParsed.repository !== producerRepository) {
    fail('Producer raw workflow ref repository does not match producerRepository.', 65);
  }
  const stage = {
    schemaVersion: 1,
    releaseCandidateId: candidate.releaseCandidateId,
    sourceSha: candidate.sourceSha,
    requestedSourceSha: candidate.sourceSha,
    checkedOutSourceSha,
    checkoutVerified: true,
    topologySha256: candidate.topologySha256,
    manifestSha256: sha256File(manifestFile),
    producerRepository,
    producerEvent: option(parsed, 'producer-event', true),
    invocationMode: option(parsed, 'invocation-mode', true),
    callerRepository: option(parsed, 'caller-repository', false) || producerRepository,
    callerWorkflowRefRaw: option(parsed, 'caller-workflow-ref-raw', false),
    callerWorkflowSha: option(parsed, 'caller-workflow-sha', false),
    callerWorkflowPath: option(parsed, 'caller-workflow-path', false),
    callerWorkflowIdentity: option(parsed, 'caller-workflow-identity', false),
    producerRunId,
    producerRunAttempt: Number(producerRunAttempt),
    producerWorkflowRefRaw,
    producerWorkflowSha,
    producerWorkflowPath: producerParsed.workflowPath,
    producerWorkflowIdentity: producerRepository + '/' + producerParsed.workflowPath + '@' + producerWorkflowSha,
    producerJob,
    artifactName,
    orchestratorRunId: option(parsed, 'orchestrator-run-id', false) || producerRunId,
    runnerClass: option(parsed, 'runner-class', true),
    stage: stageName,
    trustedProducer: false
  };
  const callerPresent = stage.callerWorkflowRefRaw || stage.callerWorkflowSha || stage.callerWorkflowPath || stage.callerWorkflowIdentity;
  if (callerPresent) {
    const callerParsed = parseWorkflowRef(stage.callerWorkflowRefRaw, 'Caller');
    requireSha40(stage.callerWorkflowSha, 'callerWorkflowSha');
    if (callerParsed.repository !== stage.callerRepository ||
        callerParsed.workflowPath !== stage.callerWorkflowPath ||
        stage.callerWorkflowIdentity !== stage.callerRepository + '/' + callerParsed.workflowPath + '@' + stage.callerWorkflowSha) {
      fail('Caller workflow fields are internally inconsistent.', 65);
    }
  }
  writeJson(outputFile, stage);
  fs.writeFileSync(outputFile + '.sha256', sha256File(outputFile) + '  ' + path.basename(outputFile) + '\n', 'utf8');
  output(JSON.stringify({ status: 'PASS', stage: stageName, output: path.relative(repositoryRoot, outputFile).replaceAll('\\', '/'), artifactSha256: sha256File(outputFile) }));
}

function commandAggregateReleaseEvidence(parsed) {
  const candidateFile = resolveRepositoryPath(option(parsed, 'candidate', true), true);
  const manifestFile = resolveRepositoryPath(option(parsed, 'manifest', true), true);
  const servicesFile = resolveRepositoryPath(option(parsed, 'services', true), true);
  const scansFile = resolveRepositoryPath(option(parsed, 'scans', true), true);
  const runtimeFile = resolveRepositoryPath(option(parsed, 'runtime-evidence', true), true);
  const recoveryFile = resolveRepositoryPath(option(parsed, 'recovery-evidence', true), true);
  const serviceVerificationFile = resolveRepositoryPath(option(parsed, 'service-verification', true), true);
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  const candidate = readJson(candidateFile);
  const manifest = readJson(manifestFile);
  const services = readJson(servicesFile);
  const scans = readJson(scansFile);
  const runtime = readJson(runtimeFile);
  const recovery = readJson(recoveryFile);
  const serviceVerification = readJson(serviceVerificationFile);
  validateCandidate(candidate);
  if (manifest.releaseCandidateId !== candidate.releaseCandidateId ||
      manifest.sourceSha !== candidate.sourceSha ||
      manifest.topologySha256 !== candidate.topologySha256) {
    fail('Image digest manifest does not belong to the candidate.', 65);
  }
  const imageItems = artifactItems(scans);
  const scanIds = collectArtifactIds(imageItems, 'Image scan summary');
  const manifestIds = new Set(digestItems(manifest).keys());
  if (!exactSet(scanIds, manifestIds) || imageItems.some((item) => !['PASS', 'APPROVED_VEX'].includes(item.status))) {
    fail('The eight immutable image scans are incomplete or non-releasable.', 65);
  }
  if (runtime.status !== 'PASS' || runtime.expectedServiceCount !== 12 || runtime.verifiedServiceCount !== 12) {
    fail('Runtime evidence is not a complete 12/12 pass.', 65);
  }
  if (recovery.status !== 'PASS' || recovery.expectedServiceCount !== 1 || recovery.verifiedServiceCount !== 1) {
    fail('Recovery evidence is not a complete 1/1 pass.', 65);
  }
  if (serviceVerification.status !== 'PASS' ||
      serviceVerification.releaseCandidateId !== candidate.releaseCandidateId ||
      serviceVerification.sourceSha !== candidate.sourceSha ||
      serviceVerification.topologySha256 !== candidate.topologySha256 ||
      serviceVerification.manifestSha256 !== sha256File(manifestFile) ||
      serviceVerification.expectedNormalRuntimeCount !== 12 ||
      serviceVerification.verifiedNormalRuntimeCount !== 12 ||
      serviceVerification.expectedRecoveryAddedCount !== 1 ||
      serviceVerification.verifiedRecoveryAddedCount !== 1 ||
      serviceVerification.expectedUnionCount !== 13 ||
      serviceVerification.verifiedUnionCount !== 13 ||
      !Array.isArray(serviceVerification.items) || serviceVerification.items.length !== 13 ||
      serviceVerification.items.some((item) => item.status !== 'PASS')) {
    fail('Final service verification is not a complete 13/13 digest-verified union.', 65);
  }
  const union = services.releaseCandidateUnion || [];
  if (union.length !== 13 || (services.normalRuntimeServices || []).length !== 12 || (services.recoveryAddedServices || []).length !== 1) {
    fail('Release service evidence does not match the approved 12 + 1 = 13 topology.', 65);
  }
  const stageFiles = options(parsed, 'stage').map((value) => resolveRepositoryPath(value, true));
  if (stageFiles.length !== 3) {
    fail('Final evidence aggregation requires exactly image, runtime, and recovery stage result files.', 64);
  }
  const stages = [];
  for (const stageFile of stageFiles) {
    const stage = readJson(stageFile);
    validateStage(stage, candidate);
    if (stage.manifestSha256 !== sha256File(manifestFile)) {
      fail('Stage manifestSha256 does not match the canonical image manifest.', 65);
    }
    stages.push({
      stage: stage.stage,
      producerRunId: stage.producerRunId,
      producerWorkflowIdentity: stage.producerWorkflowIdentity,
      artifactSha256: sha256File(stageFile)
    });
  }
  const stageNames = new Set(stages.map((stage) => stage.stage));
  if (!exactSet(stageNames, new Set(['image', 'runtime', 'recovery']))) {
    fail('Stage evidence must include exactly image, runtime, and recovery.', 65);
  }
  const evidence = {
    schemaVersion: 5,
    releaseCandidateId: candidate.releaseCandidateId,
    sourceSha: candidate.sourceSha,
    topologySha256: candidate.topologySha256,
    manifestSha256: sha256File(manifestFile),
    serviceVerification: {
      expectedNormalRuntimeCount: serviceVerification.expectedNormalRuntimeCount,
      verifiedNormalRuntimeCount: serviceVerification.verifiedNormalRuntimeCount,
      expectedRecoveryAddedCount: serviceVerification.expectedRecoveryAddedCount,
      verifiedRecoveryAddedCount: serviceVerification.verifiedRecoveryAddedCount,
      expectedUnionCount: serviceVerification.expectedUnionCount,
      verifiedUnionCount: serviceVerification.verifiedUnionCount,
      items: serviceVerification.items
    },
    stages: stages.sort((left, right) => left.stage.localeCompare(right.stage)),
    security: {
      scanComplete: true,
      images: 8,
      approvedVex: imageItems.filter((item) => item.status === 'APPROVED_VEX').map((item) => item.artifactId)
    },
    decision: 'PASS'
  };
  writeJson(outputFile, evidence);
  const checksums = [
    [sha256File(candidateFile), path.basename(candidateFile)],
    [sha256File(manifestFile), path.basename(manifestFile)],
    [sha256File(servicesFile), path.basename(servicesFile)],
    [sha256File(scansFile), path.basename(scansFile)],
    [sha256File(runtimeFile), path.basename(runtimeFile)],
    [sha256File(recoveryFile), path.basename(recoveryFile)],
    [sha256File(serviceVerificationFile), path.basename(serviceVerificationFile)],
    [sha256File(outputFile), path.basename(outputFile)]
  ];
  fs.writeFileSync(path.join(path.dirname(outputFile), 'SHA256SUMS'), checksums.map((entry) => entry[0] + '  ' + entry[1]).join('\n') + '\n', 'utf8');
  output(JSON.stringify({ status: 'PASS', output: path.relative(repositoryRoot, outputFile).replaceAll('\\', '/'), evidenceSha256: sha256File(outputFile) }));
}

function parseSimpleVexYaml(file) {
  const result = {};
  const controls = [];
  let inControls = false;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    if (line === 'compensatingControls:') {
      inControls = true;
      continue;
    }
    if (inControls && line.startsWith('- ')) {
      controls.push(line.slice(2).trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
    inControls = false;
    const match = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if (match) {
      result[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  result.compensatingControls = controls;
  return result;
}

function hasApprovedVex(directory, artifactId, imageReference, cve, nowValue) {
  if (!fs.existsSync(directory)) {
    return false;
  }
  const digest = extractDigest(imageReference);
  if (!digest) {
    return false;
  }
  const now = nowValue === undefined ? Date.now() : nowValue;
  for (const entry of fs.readdirSync(directory)) {
    const file = path.join(directory, entry);
    if (!fs.statSync(file).isFile() || !/\.(json|ya?ml)$/i.test(entry)) {
      continue;
    }
    let vex;
    try {
      vex = entry.endsWith('.json') ? readJson(file) : parseSimpleVexYaml(file);
    } catch (_) {
      continue;
    }
    const approvedAt = Date.parse(vex.approvedAt || '');
    const expiresAt = Date.parse(vex.expiresAt || '');
    const controls = Array.isArray(vex.compensatingControls) ? vex.compensatingControls : [];
    const accepted = vex.schemaVersion &&
      vex.artifact === artifactId &&
      extractDigest(vex.imageDigest || '') === digest &&
      (!cve || vex.cve === cve) &&
      vex.status === 'affected-but-accepted' &&
      vex.reason &&
      vex.approvedBy &&
      vex.trackingIssue &&
      controls.length > 0 &&
      Number.isFinite(approvedAt) &&
      Number.isFinite(expiresAt) &&
      approvedAt <= now &&
      expiresAt > now;
    if (accepted) {
      return true;
    }
  }
  return false;
}

function commandValidateVex(parsed) {
  const directory = resolveRepositoryPath(option(parsed, 'vex-dir', true), true);
  const artifactId = option(parsed, 'artifact-id', true);
  const imageReference = option(parsed, 'image', true);
  const cve = option(parsed, 'cve', false);
  const digest = extractDigest(imageReference);
  if (!digest) {
    fail('--image must identify an immutable sha256 digest.', 64);
  }
  if (hasApprovedVex(directory, artifactId, imageReference, cve)) {
    output('APPROVED_VEX');
    return;
  }
  output('NO_VALID_VEX');
  process.exitCode = 1;
}

function flag(parsed, name) {
  const value = option(parsed, name, false);
  return value === true || value === 'true' || value === '1';
}

function commandClassifyRunnerOutcome(parsed) {
  const conclusion = String(option(parsed, 'job-conclusion', true)).toLowerCase();
  const exitCode = option(parsed, 'exit-code', false);
  const expectedArtifact = option(parsed, 'expected-artifact', false);
  const artifactPresent = expectedArtifact ? fs.existsSync(resolveRepositoryPath(expectedArtifact, true)) : true;
  let status;
  if (conclusion === 'success' && artifactPresent) {
    status = 'PASS';
  } else if (flag(parsed, 'cancelled')) {
    status = 'SUPERSEDED';
  } else if (flag(parsed, 'timeout')) {
    status = 'TIMEOUT';
  } else if (String(exitCode || '') === '143' && flag(parsed, 'runner-shutdown')) {
    status = 'INFRA_FAILURE';
  } else if (!artifactPresent) {
    status = 'INCOMPLETE';
  } else {
    status = 'BUILD_FAILURE';
  }
  const result = {
    status,
    jobConclusion: conclusion,
    exitCode: exitCode === undefined ? undefined : Number(exitCode),
    runnerShutdown: flag(parsed, 'runner-shutdown'),
    cancelled: flag(parsed, 'cancelled'),
    timeout: flag(parsed, 'timeout'),
    expectedArtifactPresent: artifactPresent
  };
  output(JSON.stringify(result));
  if (status !== 'PASS') {
    process.exitCode = 1;
  }
}

function commandRecordRunnerSample(parsed) {
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  const durationSeconds = Number(option(parsed, 'duration-seconds', true));
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    fail('durationSeconds must be a non-negative number.', 64);
  }
  const runnerClass = option(parsed, 'runner-class', true);
  if (!['github-hosted', 'larger-runner', 'self-hosted-ephemeral'].includes(runnerClass)) {
    fail('runnerClass is invalid.', 64);
  }
  const status = option(parsed, 'status', true);
  if (!['PASS', 'FAIL', 'INFRA_FAILURE', 'INCOMPLETE', 'SUPERSEDED', 'TIMEOUT', 'BUILD_FAILURE'].includes(status)) {
    fail('Runner sample status is invalid.', 64);
  }
  const runId = option(parsed, 'run-id', true);
  const runAttempt = option(parsed, 'run-attempt', true);
  if (!/^[0-9]+$/.test(runId) || !/^[0-9]+$/.test(runAttempt)) {
    fail('Runner sample run ID and attempt must be decimal numbers.', 64);
  }
  const completedAt = option(parsed, 'completed-at', false) || new Date().toISOString();
  if (!Number.isFinite(Date.parse(completedAt))) {
    fail('completedAt must be an ISO-8601 timestamp.', 64);
  }
  const sample = {
    schemaVersion: 1,
    releaseCandidateId: option(parsed, 'release-candidate-id', false),
    runId,
    runAttempt: Number(runAttempt),
    workload: option(parsed, 'workload', true),
    runnerClass,
    status,
    durationSeconds,
    completedAt,
    runnerShutdown: flag(parsed, 'runner-shutdown'),
    cacheHit: option(parsed, 'cache-hit', false),
    sourceSha: option(parsed, 'source-sha', false)
  };
  if (sample.sourceSha) {
    requireSha40(sample.sourceSha, 'Runner sample sourceSha');
  }
  writeJson(outputFile, sample);
  fs.writeFileSync(outputFile + '.sha256', sha256File(outputFile) + '  ' + path.basename(outputFile) + '\n', 'utf8');
  output(JSON.stringify({ status: 'PASS', output: path.relative(repositoryRoot, outputFile).replaceAll('\\', '/') }));
}

function percentile(values, percentileValue) {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

function commandEvaluateRunnerReliability(parsed) {
  const samplesDirectory = resolveRepositoryPath(option(parsed, 'samples-dir', true), true);
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  const now = option(parsed, 'now', false) ? Date.parse(option(parsed, 'now', false)) : Date.now();
  if (!Number.isFinite(now)) {
    fail('now must be an ISO-8601 timestamp.', 64);
  }
  const imageP95TargetSeconds = Number(option(parsed, 'image-p95-target-seconds', false) || 25 * 60);
  const fullP95TargetSeconds = Number(option(parsed, 'full-p95-target-seconds', false) || 40 * 60);
  if (!Number.isFinite(imageP95TargetSeconds) || !Number.isFinite(fullP95TargetSeconds)) {
    fail('Runner P95 targets must be numeric seconds.', 64);
  }
  const entries = fs.existsSync(samplesDirectory)
    ? fs.readdirSync(samplesDirectory).filter((entry) => entry.endsWith('.json'))
    : [];
  const samples = [];
  for (const entry of entries) {
    const sample = readJson(path.join(samplesDirectory, entry));
    if (sample.schemaVersion !== 1 || !Number.isFinite(Number(sample.durationSeconds)) ||
        !Number.isFinite(Date.parse(sample.completedAt || '')) ||
        !['github-hosted', 'larger-runner', 'self-hosted-ephemeral'].includes(sample.runnerClass)) {
      fail('Runner metric sample is invalid: ' + entry, 65);
    }
    if (sample.runnerClass === 'github-hosted') {
      samples.push(sample);
    }
  }
  samples.sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
  const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;
  const window = samples.length >= 20
    ? samples.slice(0, 20)
    : samples.filter((sample) => Date.parse(sample.completedAt) >= fourteenDaysAgo);
  const durations = window.map((sample) => Number(sample.durationSeconds));
  const infraFailures = window.filter((sample) => sample.status === 'INFRA_FAILURE');
  const shutdowns = window.filter((sample) => sample.runnerShutdown).length;
  const imageSamples = window.filter((sample) => String(sample.workload).startsWith('image'));
  const fullSamples = window.filter((sample) => String(sample.workload) === 'image-security');
  const p95Image = percentile(imageSamples.map((sample) => Number(sample.durationSeconds)), 95);
  const p95Full = percentile(fullSamples.map((sample) => Number(sample.durationSeconds)), 95);
  const candidateInfraFailures = new Map();
  for (const sample of infraFailures) {
    if (sample.releaseCandidateId) {
      candidateInfraFailures.set(sample.releaseCandidateId, (candidateInfraFailures.get(sample.releaseCandidateId) || 0) + 1);
    }
  }
  const repeatedCandidateInfraFailure = [...candidateInfraFailures.values()].some((count) => count >= 2);
  const infraFailureRate = window.length === 0 ? 0 : infraFailures.length / window.length;
  const p95WithShutdown = (p95Image !== undefined && p95Image > imageP95TargetSeconds && shutdowns > 0) ||
    (p95Full !== undefined && p95Full > fullP95TargetSeconds && shutdowns > 0);
  const reliableRunnerRequired = repeatedCandidateInfraFailure ||
    (window.length >= 20 && infraFailureRate > 0.05) ||
    p95WithShutdown;
  const result = {
    schemaVersion: 1,
    evaluatedAt: new Date(now).toISOString(),
    sampleWindow: samples.length >= 20 ? 'latest-20' : 'last-14-days',
    sampleCount: window.length,
    p50Seconds: percentile(durations, 50),
    p95Seconds: percentile(durations, 95),
    maxSeconds: durations.length ? Math.max(...durations) : undefined,
    imageP95Seconds: p95Image,
    fullImageSecurityP95Seconds: p95Full,
    cacheHitRate: window.length === 0 ? undefined : window.filter((sample) => String(sample.cacheHit).toLowerCase() === 'true').length / window.length,
    infraFailureCount: infraFailures.length,
    infraFailureRate,
    runnerShutdownCount: shutdowns,
    repeatedCandidateInfraFailure,
    status: window.length === 0 ? 'INCOMPLETE' : reliableRunnerRequired ? 'RELIABLE_RUNNER_REQUIRED' : 'HOSTED_ALLOWED',
    decision: reliableRunnerRequired ? 'RELIABLE_RUNNER_REQUIRED' : 'HOSTED_ALLOWED'
  };
  writeJson(outputFile, result);
  fs.writeFileSync(outputFile + '.sha256', sha256File(outputFile) + '  ' + path.basename(outputFile) + '\n', 'utf8');
  output(JSON.stringify(result));
  if (result.status === 'RELIABLE_RUNNER_REQUIRED') {
    process.exitCode = 1;
  }
}

function commandListDigestArtifacts(parsed) {
  const manifest = readJson(resolveRepositoryPath(option(parsed, 'manifest', true), true));
  const byId = digestItems(manifest);
  for (const catalog of artifactCatalog) {
    output(catalog.artifactId + '\t' + byId.get(catalog.artifactId));
  }
}

function composeForInspection(parsed, phase) {
  const project = option(parsed, 'project', true);
  const environmentFile = resolveRepositoryPath(option(parsed, 'env', true), true);
  const baseCompose = resolveRepositoryPath(option(parsed, 'base-compose', true), true);
  const runtimeComposeOption = option(parsed, 'runtime-compose', false);
  const runtimeCompose = runtimeComposeOption ? resolveRepositoryPath(runtimeComposeOption, true) : undefined;
  const immutableComposes = options(parsed, 'immutable-compose').map((value) => resolveRepositoryPath(value, true));
  const recoveryCompose = option(parsed, 'recovery-compose', false) ? resolveRepositoryPath(option(parsed, 'recovery-compose', false), true) : undefined;
  const stateEnvironment = option(parsed, 'state-env', false) ? resolveRepositoryPath(option(parsed, 'state-env', false), true) : undefined;
  const imageEnvironment = option(parsed, 'image-env', false) ? resolveRepositoryPath(option(parsed, 'image-env', false), true) : undefined;
  const command = ['compose', '--project-name', project, '--env-file', environmentFile];
  if (stateEnvironment && fs.existsSync(stateEnvironment)) {
    command.push('--env-file', stateEnvironment);
  }
  if (imageEnvironment) {
    command.push('--env-file', imageEnvironment);
  }
  if (phase === 'runtime' && !runtimeCompose) {
    fail('--runtime-compose is required for runtime digest verification.', 64);
  }
  command.push('-f', baseCompose);
  if (runtimeCompose) {
    command.push('-f', runtimeCompose);
  }
  for (const immutableCompose of immutableComposes) {
    command.push('-f', immutableCompose);
  }
  if (phase === 'recovery') {
    if (!recoveryCompose) {
      fail('--recovery-compose is required for recovery digest verification.', 64);
    }
    command.push('-f', recoveryCompose);
  }
  return command;
}

function extractDigest(value) {
  const match = String(value || '').match(/sha256:[0-9a-f]{64}/);
  return match ? match[0] : undefined;
}

function inspectContainerDigest(containerId) {
  const container = JSON.parse(run('docker', ['inspect', containerId]))[0];
  const imageId = String(container.Image || '');
  let repoDigests = [];
  try {
    const raw = run('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', imageId]).trim();
    repoDigests = raw && raw !== 'null' ? JSON.parse(raw) : [];
  } catch (_) {
    repoDigests = [];
  }
  return {
    state: container.State || {},
    configImage: container.Config && container.Config.Image,
    candidates: [container.Config && container.Config.Image, ...repoDigests].filter(Boolean),
    actualDigest: [container.Config && container.Config.Image, ...repoDigests].map(extractDigest).find(Boolean)
  };
}

function commandVerifyServiceDigests(parsed) {
  const phase = option(parsed, 'phase', true);
  if (!['runtime', 'recovery'].includes(phase)) {
    fail('--phase must be runtime or recovery.', 64);
  }
  const services = readJson(resolveRepositoryPath(option(parsed, 'services', true), true));
  const manifest = readJson(resolveRepositoryPath(option(parsed, 'manifest', true), true));
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  const byArtifact = digestItems(manifest);
  const expectedServices = phase === 'runtime' ? services.normalRuntimeServices : services.recoveryAddedServices;
  if (!Array.isArray(expectedServices) || expectedServices.length === 0) {
    fail('No required ' + phase + ' services were found in the release-services document.', 65);
  }
  const compose = composeForInspection(parsed, phase);
  const observations = [];
  let passed = true;
  for (const record of expectedServices) {
    // --all is mandatory for one-shot init services. Without it, a successful
    // exited(0) initializer can disappear from evidence and turn a valid
    // 12/12 runtime into an unverifiable result.
    const containerId = run('docker', [...compose, 'ps', '--all', '-q', record.service]).trim().split(/\r?\n/)[0];
    const expectedReference = byArtifact.get(record.artifactId);
    const expectedDigest = extractDigest(expectedReference);
    const observation = {
      serviceId: record.serviceId,
      service: record.service,
      artifactId: record.artifactId,
      phase,
      expectedDigest,
      status: 'FAIL'
    };
    if (!containerId) {
      observation.reason = 'container-missing';
      passed = false;
      observations.push(observation);
      continue;
    }
    const inspected = inspectContainerDigest(containerId);
    observation.containerId = containerId;
    observation.containerState = inspected.state.Status || 'unknown';
    observation.exitCode = inspected.state.ExitCode;
    observation.actualDigest = inspected.actualDigest;
    const oneShot = String(record.lifecycle || '').startsWith('one-shot');
    const lifecycleValid = oneShot
      ? inspected.state.Status === 'exited' && Number(inspected.state.ExitCode) === 0
      : inspected.state.Status === 'running' && (!inspected.state.Health || inspected.state.Health.Status === 'healthy');
    const digestValid = expectedDigest && inspected.actualDigest === expectedDigest;
    if (lifecycleValid && digestValid) {
      observation.status = 'PASS';
    } else {
      observation.reason = !lifecycleValid ? 'lifecycle-invalid' : 'digest-mismatch-or-unresolved';
      passed = false;
    }
    observations.push(observation);
  }
  const result = {
    schemaVersion: 1,
    phase,
    expectedServiceCount: expectedServices.length,
    verifiedServiceCount: observations.filter((item) => item.status === 'PASS').length,
    manifestSha256: sha256File(resolveRepositoryPath(option(parsed, 'manifest', true), true)),
    observations,
    status: passed ? 'PASS' : 'FAIL'
  };
  writeJson(outputFile, result);
  output(JSON.stringify({ status: result.status, phase, verified: result.verifiedServiceCount, expected: result.expectedServiceCount, output: path.relative(repositoryRoot, outputFile).replaceAll('\\', '/') }));
  if (!passed) {
    process.exitCode = 1;
  }
}

function commandAggregateServiceDigests(parsed) {
  const candidateFile = resolveRepositoryPath(option(parsed, 'candidate', true), true);
  const servicesFile = resolveRepositoryPath(option(parsed, 'services', true), true);
  const manifestFile = resolveRepositoryPath(option(parsed, 'manifest', true), true);
  const runtimeFile = resolveRepositoryPath(option(parsed, 'runtime-evidence', true), true);
  const recoveryFile = resolveRepositoryPath(option(parsed, 'recovery-evidence', true), true);
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  const candidate = readJson(candidateFile);
  const services = readJson(servicesFile);
  const manifest = readJson(manifestFile);
  const runtime = readJson(runtimeFile);
  const recovery = readJson(recoveryFile);
  validateCandidate(candidate);

  if (sha256File(servicesFile) !== candidate.servicesSha256 ||
      manifest.releaseCandidateId !== candidate.releaseCandidateId ||
      manifest.sourceSha !== candidate.sourceSha ||
      manifest.topologySha256 !== candidate.topologySha256) {
    fail('Service or image evidence does not belong to the supplied release candidate.', 65);
  }
  const manifestSha256 = sha256File(manifestFile);
  const normalRecords = services.normalRuntimeServices || [];
  const recoveryAddedRecords = services.recoveryAddedServices || [];
  const unionRecords = services.releaseCandidateUnion || [];
  if (normalRecords.length !== 12 || recoveryAddedRecords.length !== 1 || unionRecords.length !== 13) {
    fail('Release service document does not match the approved 12 + 1 = 13 topology.', 65);
  }
  const unionById = new Map();
  for (const record of unionRecords) {
    if (!record || !record.serviceId || !record.service || !record.artifactId || unionById.has(record.serviceId)) {
      fail('Release service union contains an invalid or duplicate service identity.', 65);
    }
    unionById.set(record.serviceId, record);
  }

  function inspectEvidence(evidence, phase, requiredRecords, allowReused) {
    const observations = Array.isArray(evidence.observations) ? evidence.observations : [];
    const requiredById = new Map(requiredRecords.map((record) => [record.serviceId, record]));
    const seenRequired = new Map();
    const accepted = [];
    const unknown = [];
    const invalid = [];
    if (evidence.status !== 'PASS' || evidence.manifestSha256 !== manifestSha256 ||
        Number(evidence.expectedServiceCount) !== requiredRecords.length ||
        Number(evidence.verifiedServiceCount) !== requiredRecords.length) {
      invalid.push('evidence-header');
    }
    for (const observation of observations) {
      const record = unionById.get(observation && observation.serviceId);
      if (!record || record.service !== observation.service || record.artifactId !== observation.artifactId) {
        unknown.push(observation && observation.serviceId ? observation.serviceId : 'missing-service-id');
        continue;
      }
      const isRequired = requiredById.has(record.serviceId);
      if (!isRequired && !allowReused) {
        unknown.push(record.serviceId);
        continue;
      }
      if (observation.phase !== phase || observation.status !== 'PASS' ||
          !observation.containerId || !observation.expectedDigest ||
          observation.expectedDigest !== observation.actualDigest) {
        invalid.push(record.serviceId);
        continue;
      }
      if (String(record.lifecycle || '').startsWith('one-shot') &&
          !(observation.containerState === 'exited' && Number(observation.exitCode) === 0)) {
        invalid.push(record.serviceId);
        continue;
      }
      if (isRequired) {
        if (seenRequired.has(record.serviceId)) {
          invalid.push(record.serviceId);
          continue;
        }
        seenRequired.set(record.serviceId, observation);
      }
      accepted.push(observation);
    }
    const missing = requiredRecords.filter((record) => !seenRequired.has(record.serviceId)).map((record) => record.serviceId);
    return { accepted, byRequiredId: seenRequired, missing, unknown, invalid };
  }

  const runtimeCheck = inspectEvidence(runtime, 'runtime', normalRecords, false);
  const recoveryCheck = inspectEvidence(recovery, 'recovery', recoveryAddedRecords, true);
  const observationsById = new Map();
  for (const observation of [...runtimeCheck.accepted, ...recoveryCheck.accepted]) {
    const entries = observationsById.get(observation.serviceId) || [];
    entries.push(observation);
    observationsById.set(observation.serviceId, entries);
  }
  const items = unionRecords.map((record) => {
    const observations = observationsById.get(record.serviceId) || [];
    const requiredPhase = record.serviceSet === 'recovery-added' ? 'recovery' : 'runtime';
    const requiredObservation = observations.find((observation) => observation.phase === requiredPhase);
    return {
      serviceId: record.serviceId,
      service: record.service,
      artifactId: record.artifactId,
      serviceSet: record.serviceSet,
      lifecycle: record.lifecycle,
      expectedDigest: requiredObservation && requiredObservation.expectedDigest,
      actualDigest: requiredObservation && requiredObservation.actualDigest,
      observations,
      status: requiredObservation && requiredObservation.status === 'PASS' ? 'PASS' : 'FAIL'
    };
  });
  const missingServiceIds = [...runtimeCheck.missing, ...recoveryCheck.missing];
  const unknownServiceIds = [...new Set([...runtimeCheck.unknown, ...recoveryCheck.unknown])];
  const invalidServiceIds = [...new Set([...runtimeCheck.invalid, ...recoveryCheck.invalid])];
  const verifiedUnionCount = items.filter((item) => item.status === 'PASS').length;
  const passed = missingServiceIds.length === 0 && unknownServiceIds.length === 0 && invalidServiceIds.length === 0 && verifiedUnionCount === 13;
  const result = {
    schemaVersion: 1,
    releaseCandidateId: candidate.releaseCandidateId,
    sourceSha: candidate.sourceSha,
    topologySha256: candidate.topologySha256,
    manifestSha256,
    expectedNormalRuntimeCount: 12,
    verifiedNormalRuntimeCount: runtimeCheck.byRequiredId.size,
    expectedRecoveryAddedCount: 1,
    verifiedRecoveryAddedCount: recoveryCheck.byRequiredId.size,
    expectedUnionCount: 13,
    verifiedUnionCount,
    missingServiceIds,
    unknownServiceIds,
    invalidServiceIds,
    items,
    status: passed ? 'PASS' : 'FAIL'
  };
  writeJson(outputFile, result);
  fs.writeFileSync(outputFile + '.sha256', sha256File(outputFile) + '  ' + path.basename(outputFile) + '\n', 'utf8');
  output(JSON.stringify({
    status: result.status,
    expectedUnionCount: result.expectedUnionCount,
    verifiedUnionCount: result.verifiedUnionCount,
    output: path.relative(repositoryRoot, outputFile).replaceAll('\\', '/')
  }));
  if (!passed) {
    process.exitCode = 1;
  }
}

function commandBuildRetryManifest(parsed) {
  const candidateFile = resolveRepositoryPath(option(parsed, 'candidate', true), true);
  const topologyFile = resolveRepositoryPath(option(parsed, 'topology', true), true);
  const resultsDirectory = resolveRepositoryPath(option(parsed, 'build-results-dir', true), true);
  const outputFile = resolveRepositoryPath(option(parsed, 'output', true), true);
  const candidate = readJson(candidateFile);
  const topology = readJson(topologyFile);
  validateCandidate(candidate);
  if (sha256File(topologyFile) !== candidate.topologySha256) {
    fail('Candidate topologySha256 does not match the supplied topology file.', 65);
  }
  const results = new Map();
  if (fs.existsSync(resultsDirectory)) {
    for (const entry of fs.readdirSync(resultsDirectory)) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const file = path.join(resultsDirectory, entry);
      const result = readJson(file);
      if (!result.artifactId) {
        continue;
      }
      if (results.has(result.artifactId)) {
        fail('Build result directory has duplicate result for ' + result.artifactId + '.', 65);
      }
      const checksumFile = file + '.sha256';
      const checksumValid = fs.existsSync(checksumFile) && parseExpectedHash(checksumFile) === sha256File(file);
      results.set(result.artifactId, { result, checksumValid, resultSha256: sha256File(file) });
    }
  }
  const preservedArtifacts = [];
  const retryArtifacts = [];
  for (const artifact of artifactItems(topology).filter((item) => item.origin === 'built')) {
    const stored = results.get(artifact.artifactId);
    const result = stored && stored.result;
    const valid = Boolean(stored && stored.checksumValid && result &&
      result.status === 'PASS' &&
      result.releaseCandidateId === candidate.releaseCandidateId &&
      result.sourceSha === candidate.sourceSha &&
      result.topologySha256 === candidate.topologySha256 &&
      typeof result.immutableRef === 'string' && result.immutableRef.includes('@sha256:'));
    if (valid) {
      preservedArtifacts.push({ artifactId: artifact.artifactId, immutableRef: result.immutableRef, resultSha256: stored.resultSha256 });
    } else {
      retryArtifacts.push(artifact.artifactId);
    }
  }
  const result = {
    schemaVersion: 1,
    releaseCandidateId: candidate.releaseCandidateId,
    sourceSha: candidate.sourceSha,
    topologySha256: candidate.topologySha256,
    attempt: Number(option(parsed, 'attempt', false) || 2),
    preservedArtifacts,
    retryArtifacts,
    status: retryArtifacts.length === 0 ? 'PASS' : 'RETRY_REQUIRED'
  };
  writeJson(outputFile, result);
  fs.writeFileSync(outputFile + '.sha256', sha256File(outputFile) + '  ' + path.basename(outputFile) + '\n', 'utf8');
  output(JSON.stringify({ status: result.status, retryArtifacts: result.retryArtifacts, output: path.relative(repositoryRoot, outputFile).replaceAll('\\', '/') }));
}

function commandPrepareCandidate(parsed) {
  const sourceSha = option(parsed, 'source-sha', true);
  requireSha40(sourceSha, 'sourceSha');
  const releaseCandidateId = option(parsed, 'release-candidate-id', true);
  if (!/^r1-rc[._-].+-[0-9a-f]{12}$/.test(releaseCandidateId) || !releaseCandidateId.endsWith(sourceSha.slice(0, 12))) {
    fail('releaseCandidateId must be immutable and end with sourceSha[0:12].', 64);
  }
  const outputDirectory = resolveRepositoryPath(option(parsed, 'output-dir', true), true);
  const parameters = composeParameters(parsed);
  const collected = collectTopology(parameters, sourceSha);
  const services = buildServiceDocument(collected, collected.topology, sourceSha);
  const topologyFile = path.join(outputDirectory, 'release-topology.json');
  const servicesFile = path.join(outputDirectory, 'release-services.json');
  writeJson(topologyFile, collected.topology);
  writeJson(servicesFile, services);
  const candidate = {
    schemaVersion: 1,
    releaseCandidateId,
    sourceSha,
    topologySha256: sha256File(topologyFile),
    servicesSha256: sha256File(servicesFile),
    expected: collected.topology.expected
  };
  const candidateFile = path.join(outputDirectory, 'release-candidate.json');
  writeJson(candidateFile, candidate);
  output(JSON.stringify({
    status: 'PASS',
    candidate: path.relative(repositoryRoot, candidateFile).replaceAll('\\', '/'),
    topologySha256: candidate.topologySha256,
    servicesSha256: candidate.servicesSha256
  }));
}

function usage() {
  output('Usage: node scripts/ci/release-tools.mjs <command> [options]');
  output('Commands: discover-images, discover-services, verify-image-set, prepare-candidate,');
  output('          build-image, assemble-image-manifest, create-image-scan-result, assemble-image-scans, write-stage-result,');
  output('          aggregate-release-evidence, aggregate-service-digests, build-retry-manifest, record-runner-sample, evaluate-runner-reliability, validate-vex, classify-runner-outcome, list-digest-artifacts,');
  output('          render-digest-env, verify-service-digests, validate-release-candidate,');
  output('          validate-digest-manifest, validate-stage-handoff, validate-trusted-producer');
}

const command = process.argv[2];
const parsed = parseArguments(process.argv.slice(3));
try {
  switch (command) {
    case 'discover-images':
      commandDiscoverImages(parsed);
      break;
    case 'discover-services':
      commandDiscoverServices(parsed);
      break;
    case 'verify-image-set':
      commandVerifyImageSet(parsed);
      break;
    case 'prepare-candidate':
      commandPrepareCandidate(parsed);
      break;
    case 'build-image':
      commandBuildImage(parsed);
      break;
    case 'assemble-image-manifest':
      commandAssembleImageManifest(parsed);
      break;
    case 'create-image-scan-result':
      commandCreateImageScanResult(parsed);
      break;
    case 'assemble-image-scans':
      commandAssembleImageScans(parsed);
      break;
    case 'write-stage-result':
      commandWriteStageResult(parsed);
      break;
    case 'aggregate-release-evidence':
      commandAggregateReleaseEvidence(parsed);
      break;
    case 'validate-vex':
      commandValidateVex(parsed);
      break;
    case 'classify-runner-outcome':
      commandClassifyRunnerOutcome(parsed);
      break;
    case 'record-runner-sample':
      commandRecordRunnerSample(parsed);
      break;
    case 'evaluate-runner-reliability':
      commandEvaluateRunnerReliability(parsed);
      break;
    case 'list-digest-artifacts':
      commandListDigestArtifacts(parsed);
      break;
    case 'render-digest-env':
      commandRenderDigestEnvironment(parsed);
      break;
    case 'validate-digest-manifest':
      commandValidateDigestManifest(parsed);
      break;
    case 'verify-service-digests':
      commandVerifyServiceDigests(parsed);
      break;
    case 'aggregate-service-digests':
      commandAggregateServiceDigests(parsed);
      break;
    case 'build-retry-manifest':
      commandBuildRetryManifest(parsed);
      break;
    case 'validate-release-candidate':
      commandValidateReleaseCandidate(parsed);
      break;
    case 'validate-stage-handoff':
      commandValidateStageHandoff(parsed);
      break;
    case 'validate-trusted-producer':
      commandValidateTrustedProducer(parsed);
      break;
    case '--help':
    case 'help':
    case undefined:
      usage();
      break;
    default:
      fail('Unknown command: ' + command, 64);
  }
} catch (error) {
  process.stderr.write('[release-tools] ' + error.message + '\n');
  process.exitCode = error.exitCode || 1;
}
