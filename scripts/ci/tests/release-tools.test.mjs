import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, '..', '..', '..');
const tool = path.join(repositoryRoot, 'scripts', 'ci', 'release-tools.mjs');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-manager-release-tools-'));
const sourceSha = 'a'.repeat(40);
const topologySha = 'b'.repeat(64);
const digest = 'sha256:' + 'c'.repeat(64);
const candidateId = 'r1-rc-test-' + sourceSha.slice(0, 12);

function writeJson(name, value) {
  const file = path.join(temporaryRoot, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return file;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeChecksum(file) {
  fs.writeFileSync(file + '.sha256', sha256File(file) + '  ' + path.basename(file) + '\n', 'utf8');
}

function run(command, argumentsList, expectedExitCode) {
  const result = spawnSync(process.execPath, [tool, command, ...argumentsList], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  const expected = expectedExitCode === undefined ? 0 : expectedExitCode;
  assert.equal(result.status, expected, (result.stderr || result.stdout || '').trim());
  return (result.stdout || '').trim();
}

try {
  const candidateFile = writeJson('release-candidate.json', {
    schemaVersion: 1,
    releaseCandidateId: candidateId,
    sourceSha,
    topologySha256: topologySha
  });
  const artifactIds = ['IMG-R01', 'IMG-R02', 'IMG-R03', 'IMG-R04', 'IMG-R05', 'IMG-R06', 'IMG-R07', 'IMG-R08'];
  const manifestFile = writeJson('image-digests.json', {
    schemaVersion: 1,
    releaseCandidateId: candidateId,
    sourceSha,
    topologySha256: topologySha,
    artifacts: artifactIds.map((artifactId) => ({
      artifactId,
      origin: 'external',
      immutableRef: 'ghcr.io/example/' + artifactId.toLowerCase() + '@' + digest
    }))
  });

  const environmentFile = path.join(temporaryRoot, 'image-digests.env');
  run('render-digest-env', ['--manifest', manifestFile, '--output', environmentFile]);
  const environmentLines = fs.readFileSync(environmentFile, 'utf8').trim().split(/\r?\n/);
  assert.equal(environmentLines.length, 8);
  assert.ok(environmentLines.every((line) => line.includes('@' + digest)));

  const trustedArguments = [
    '--source-sha', sourceSha,
    '--approved-repository', 'xxbb11122/IotManager',
    '--approved-producer-path', '.github/workflows/image-security.yml',
    '--approved-caller-path', '.github/workflows/release-gate.yml',
    '--allowed-event', 'workflow_call',
    '--allowed-invocation-mode', 'orchestrated-reusable',
    '--producer-repository', 'xxbb11122/IotManager',
    '--producer-event', 'workflow_call',
    '--invocation-mode', 'orchestrated-reusable',
    '--caller-repository', 'xxbb11122/IotManager',
    '--caller-workflow-ref-raw', 'xxbb11122/IotManager/.github/workflows/release-gate.yml@refs/heads/main',
    '--caller-workflow-sha', sourceSha,
    '--caller-workflow-path', '.github/workflows/release-gate.yml',
    '--caller-workflow-identity', 'xxbb11122/IotManager/.github/workflows/release-gate.yml@' + sourceSha,
    '--caller-workflow-ref-raw', 'xxbb11122/IotManager/.github/workflows/release-gate.yml@refs/heads/main',
    '--caller-workflow-sha', sourceSha,
    '--caller-workflow-path', '.github/workflows/release-gate.yml',
    '--caller-workflow-identity', 'xxbb11122/IotManager/.github/workflows/release-gate.yml@' + sourceSha,
    '--producer-run-id', '123',
    '--producer-run-attempt', '1',
    '--producer-workflow-ref-raw', 'xxbb11122/IotManager/.github/workflows/image-security.yml@refs/heads/main',
    '--producer-workflow-sha', sourceSha,
    '--producer-workflow-path', '.github/workflows/image-security.yml',
    '--producer-workflow-identity', 'xxbb11122/IotManager/.github/workflows/image-security.yml@' + sourceSha,
    '--producer-job', 'image-security-gate',
    '--artifact-sha256', 'd'.repeat(64),
    '--release-candidate-id', candidateId
  ];
  assert.equal(run('validate-trusted-producer', trustedArguments), 'TRUSTED');

  const invalidTrusted = [...trustedArguments];
  invalidTrusted[invalidTrusted.indexOf('--producer-workflow-identity') + 1] = 'xxbb11122/IotManager/.github/workflows/image-security.yml@' + 'e'.repeat(40);
  assert.equal(run('validate-trusted-producer', invalidTrusted, 1), 'WORKFLOW_IDENTITY_MISMATCH');

  const vexDirectory = path.join(temporaryRoot, 'vex');
  fs.mkdirSync(vexDirectory);
  writeJson(path.join('vex', 'approved.json'), {
    schemaVersion: 1,
    cve: 'CVE-2099-0001',
    artifact: 'IMG-R01',
    imageDigest: digest,
    status: 'affected-but-accepted',
    reason: 'upstream-no-fix',
    compensatingControls: ['internal-network-only'],
    approvedBy: 'security-owner',
    approvedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2099-01-01T00:00:00Z',
    trackingIssue: 'SEC-123'
  });
  assert.equal(run('validate-vex', [
    '--vex-dir', vexDirectory,
    '--artifact-id', 'IMG-R01',
    '--image', 'ghcr.io/example/backend@' + digest,
    '--cve', 'CVE-2099-0001'
  ]), 'APPROVED_VEX');

  const stageFile = path.join(temporaryRoot, 'stage-image.json');
  run('write-stage-result', [
    '--candidate', candidateFile,
    '--manifest', manifestFile,
    '--stage', 'image',
    '--checked-out-source-sha', sourceSha,
    '--producer-repository', 'xxbb11122/IotManager',
    '--producer-event', 'workflow_call',
    '--invocation-mode', 'orchestrated-reusable',
    '--caller-repository', 'xxbb11122/IotManager',
    '--caller-workflow-ref-raw', 'xxbb11122/IotManager/.github/workflows/release-gate.yml@refs/heads/main',
    '--caller-workflow-sha', sourceSha,
    '--caller-workflow-path', '.github/workflows/release-gate.yml',
    '--caller-workflow-identity', 'xxbb11122/IotManager/.github/workflows/release-gate.yml@' + sourceSha,
    '--producer-run-id', '123',
    '--producer-run-attempt', '1',
    '--producer-workflow-ref-raw', 'xxbb11122/IotManager/.github/workflows/image-security.yml@refs/heads/main',
    '--producer-workflow-sha', sourceSha,
    '--producer-job', 'image-security-gate',
    '--artifact-name', 'release-evidence-test',
    '--runner-class', 'github-hosted',
    '--output', stageFile
  ]);
  assert.ok(fs.existsSync(stageFile + '.sha256'));
  assert.equal(run('validate-release-candidate', ['--candidate', candidateFile, '--stage', stageFile, '--expected-stage', 'image']), 'PASS');
  assert.match(run('classify-runner-outcome', [
    '--job-conclusion', 'cancelled',
    '--exit-code', '143',
    '--runner-shutdown', 'true',
    '--cancelled', 'true'
  ], 1), /SUPERSEDED/);
  assert.match(run('classify-runner-outcome', [
    '--job-conclusion', 'failure',
    '--exit-code', '143',
    '--runner-shutdown', 'true'
  ], 1), /INFRA_FAILURE/);

  const topologyFile = writeJson('topology.json', {
    schemaVersion: 1,
    artifacts: artifactIds.map((artifactId, index) => ({
      artifactId,
      origin: index < 6 ? 'built' : 'external',
      image: 'ghcr.io/example/' + artifactId.toLowerCase() + '@' + digest
    }))
  });
  const servicesFile = writeJson('services.json', {
    schemaVersion: 1,
    expected: { normalRuntimeServices: 12, recoveryAddedServices: 1, releaseCandidateServices: 13 },
    normalRuntimeServices: Array.from({ length: 12 }, (_, index) => ({
      serviceId: 'SVC-' + String(index + 1).padStart(2, '0'),
      service: 'runtime-' + (index + 1),
      artifactId: artifactIds[index % artifactIds.length],
      serviceSet: 'normal-runtime',
      lifecycle: 'long-running'
    })),
    recoveryAddedServices: [{
      serviceId: 'SVC-13', service: 'wal-g-recovery', artifactId: 'IMG-R04', serviceSet: 'recovery-added', lifecycle: 'one-shot-recovery'
    }],
    releaseCandidateUnion: []
  });
  const serviceDocument = JSON.parse(fs.readFileSync(servicesFile, 'utf8'));
  serviceDocument.releaseCandidateUnion = [...serviceDocument.normalRuntimeServices, ...serviceDocument.recoveryAddedServices];
  fs.writeFileSync(servicesFile, JSON.stringify(serviceDocument, null, 2) + '\n', 'utf8');
  const strictCandidateFile = writeJson('strict-candidate.json', {
    schemaVersion: 1,
    releaseCandidateId: candidateId,
    sourceSha,
    topologySha256: sha256File(topologyFile),
    servicesSha256: sha256File(servicesFile),
    expected: { artifacts: 8, buildableArtifacts: 6, normalRuntimeServices: 12, recoveryAddedServices: 1, releaseCandidateServices: 13 }
  });
  const strictManifestFile = writeJson('strict-image-digests.json', {
    schemaVersion: 1,
    releaseCandidateId: candidateId,
    sourceSha,
    topologySha256: sha256File(topologyFile),
    artifacts: artifactIds.map((artifactId, index) => ({
      artifactId,
      origin: index < 6 ? 'built' : 'external',
      immutableRef: 'ghcr.io/example/' + artifactId.toLowerCase() + '@' + digest
    }))
  });
  assert.match(run('validate-digest-manifest', [
    '--candidate', strictCandidateFile,
    '--topology', topologyFile,
    '--services', servicesFile,
    '--manifest', strictManifestFile,
    '--expected-manifest-sha256', sha256File(strictManifestFile),
    '--expected-release-candidate-id', candidateId,
    '--expected-source-sha', sourceSha
  ]), /"status":"PASS"/);

  const highReportFile = writeJson('high-report.json', {
    Results: [{ Vulnerabilities: [{ VulnerabilityID: 'CVE-2099-0001', Severity: 'HIGH' }] }]
  });
  const vexScanFile = path.join(temporaryRoot, 'vex-scan.json');
  assert.match(run('create-image-scan-result', [
    '--candidate', strictCandidateFile,
    '--manifest', strictManifestFile,
    '--artifact-id', 'IMG-R01',
    '--report', highReportFile,
    '--vex-dir', vexDirectory,
    '--scanner-exit-code', '0',
    '--output', vexScanFile
  ]), /"status":"APPROVED_VEX"/);

  const runtimeEvidenceFile = writeJson('runtime-evidence.json', {
    schemaVersion: 1,
    phase: 'runtime',
    expectedServiceCount: 12,
    verifiedServiceCount: 12,
    manifestSha256: sha256File(strictManifestFile),
    observations: serviceDocument.normalRuntimeServices.map((record) => ({
      ...record,
      phase: 'runtime',
      containerId: 'container-' + record.serviceId,
      containerState: 'running',
      expectedDigest: digest,
      actualDigest: digest,
      status: 'PASS'
    })),
    status: 'PASS'
  });
  const recoveryEvidenceFile = writeJson('recovery-evidence.json', {
    schemaVersion: 1,
    phase: 'recovery',
    expectedServiceCount: 1,
    verifiedServiceCount: 1,
    manifestSha256: sha256File(strictManifestFile),
    observations: [{
      ...serviceDocument.recoveryAddedServices[0],
      phase: 'recovery',
      containerId: 'container-SVC-13',
      containerState: 'exited',
      exitCode: 0,
      expectedDigest: digest,
      actualDigest: digest,
      status: 'PASS'
    }],
    status: 'PASS'
  });
  const unionEvidenceFile = path.join(temporaryRoot, 'union-evidence.json');
  assert.match(run('aggregate-service-digests', [
    '--candidate', strictCandidateFile,
    '--services', servicesFile,
    '--manifest', strictManifestFile,
    '--runtime-evidence', runtimeEvidenceFile,
    '--recovery-evidence', recoveryEvidenceFile,
    '--output', unionEvidenceFile
  ]), /"verifiedUnionCount":13/);
  assert.equal(JSON.parse(fs.readFileSync(unionEvidenceFile, 'utf8')).status, 'PASS');

  const scansFile = writeJson('scanned-images.json', {
    schemaVersion: 1,
    releaseCandidateId: candidateId,
    sourceSha,
    topologySha256: sha256File(topologyFile),
    manifestSha256: sha256File(strictManifestFile),
    images: artifactIds.map((artifactId) => ({
      artifactId,
      targetDigest: 'ghcr.io/example/' + artifactId.toLowerCase() + '@' + digest,
      status: 'PASS'
    })),
    status: 'PASS'
  });
  const stagePaths = [];
  for (const [stage, workflow] of [
    ['image', '.github/workflows/image-security.yml'],
    ['runtime', '.github/workflows/runtime-e2e.yml'],
    ['recovery', '.github/workflows/recovery-drill.yml']
  ]) {
    const stagePath = path.join(temporaryRoot, 'stage-' + stage + '.json');
    run('write-stage-result', [
      '--candidate', strictCandidateFile,
      '--manifest', strictManifestFile,
      '--stage', stage,
      '--checked-out-source-sha', sourceSha,
      '--producer-repository', 'xxbb11122/IotManager',
      '--producer-event', 'workflow_call',
      '--invocation-mode', 'orchestrated-reusable',
      '--caller-repository', 'xxbb11122/IotManager',
      '--caller-workflow-ref-raw', 'xxbb11122/IotManager/.github/workflows/release-gate.yml@refs/heads/main',
      '--caller-workflow-sha', sourceSha,
      '--caller-workflow-path', '.github/workflows/release-gate.yml',
      '--caller-workflow-identity', 'xxbb11122/IotManager/.github/workflows/release-gate.yml@' + sourceSha,
      '--producer-run-id', stage === 'image' ? '201' : stage === 'runtime' ? '202' : '203',
      '--producer-run-attempt', '1',
      '--producer-workflow-ref-raw', 'xxbb11122/IotManager/' + workflow + '@refs/heads/main',
      '--producer-workflow-sha', sourceSha,
      '--producer-job', stage + '-job',
      '--artifact-name', stage + '-artifact',
      '--runner-class', stage === 'recovery' ? 'self-hosted-ephemeral' : 'github-hosted',
      '--output', stagePath
    ]);
    stagePaths.push(stagePath);
  }
  const finalEvidenceFile = path.join(temporaryRoot, 'evidence-manifest.json');
  assert.match(run('aggregate-release-evidence', [
    '--candidate', strictCandidateFile,
    '--manifest', strictManifestFile,
    '--services', servicesFile,
    '--scans', scansFile,
    '--runtime-evidence', runtimeEvidenceFile,
    '--recovery-evidence', recoveryEvidenceFile,
    '--service-verification', unionEvidenceFile,
    '--stage', stagePaths[0],
    '--stage', stagePaths[1],
    '--stage', stagePaths[2],
    '--output', finalEvidenceFile
  ]), /"status":"PASS"/);
  assert.equal(JSON.parse(fs.readFileSync(finalEvidenceFile, 'utf8')).serviceVerification.verifiedUnionCount, 13);

  const buildResultsDirectory = path.join(temporaryRoot, 'build-results');
  fs.mkdirSync(buildResultsDirectory);
  for (const artifactId of artifactIds.slice(0, 6)) {
    const resultFile = writeJson(path.join('build-results', artifactId + '.json'), {
      artifactId,
      status: 'PASS',
      releaseCandidateId: candidateId,
      sourceSha,
      topologySha256: sha256File(topologyFile),
      immutableRef: 'ghcr.io/example/' + artifactId.toLowerCase() + '@' + digest,
      requestedSourceSha: sourceSha,
      checkedOutSourceSha: sourceSha,
      checkoutVerified: true,
      producerRepository: 'xxbb11122/IotManager',
      producerEvent: 'workflow_call',
      invocationMode: 'orchestrated-reusable',
      producerRunId: '801',
      producerRunAttempt: 1,
      producerWorkflowRefRaw: 'xxbb11122/IotManager/.github/workflows/image-security.yml@refs/heads/main',
      producerWorkflowSha: sourceSha,
      producerWorkflowPath: '.github/workflows/image-security.yml',
      producerWorkflowIdentity: 'xxbb11122/IotManager/.github/workflows/image-security.yml@' + sourceSha,
      producerJob: 'build-' + artifactId,
      runnerClass: 'github-hosted'
    });
    writeChecksum(resultFile);
  }
  const assembledManifestFile = path.join(temporaryRoot, 'assembled-image-digests.json');
  assert.match(run('assemble-image-manifest', [
    '--candidate', strictCandidateFile,
    '--topology', topologyFile,
    '--build-results-dir', buildResultsDirectory,
    '--output', assembledManifestFile
  ]), /"artifacts":8/);
  const retryManifestFile = path.join(temporaryRoot, 'build-retry-manifest.json');
  assert.match(run('build-retry-manifest', [
    '--candidate', strictCandidateFile,
    '--topology', topologyFile,
    '--build-results-dir', buildResultsDirectory,
    '--output', retryManifestFile
  ]), /"status":"PASS"/);
  assert.deepEqual(JSON.parse(fs.readFileSync(retryManifestFile, 'utf8')).retryArtifacts, []);

  const samplesDirectory = path.join(temporaryRoot, 'runner-samples');
  fs.mkdirSync(samplesDirectory);
  run('record-runner-sample', [
    '--output', path.join(samplesDirectory, 'sample-1.json'),
    '--run-id', '501',
    '--run-attempt', '1',
    '--workload', 'image-security',
    '--runner-class', 'github-hosted',
    '--status', 'PASS',
    '--duration-seconds', '120',
    '--completed-at', '2026-09-02T00:00:00Z',
    '--source-sha', sourceSha
  ]);
  const runnerMetricsFile = path.join(temporaryRoot, 'runner-metrics.json');
  assert.match(run('evaluate-runner-reliability', [
    '--samples-dir', samplesDirectory,
    '--output', runnerMetricsFile,
    '--now', '2026-09-02T01:00:00Z'
  ]), /"status":"HOSTED_ALLOWED"/);

  process.stdout.write('PASS release-tools contract tests\n');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
