import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {validateEvidenceVex} from '../vex-evidence.mjs';

test('evidence VEX binds source, digest, proof bytes and separate review; invalid records fail closed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-vex-proof-'));
  try {
    const context = {directory, artifactId: 'IMG-R01', digest: 'sha256:'+'a'.repeat(64), cve: 'CVE-2099-0001', sourceSha: 'b'.repeat(40), now: Date.parse('2026-10-20T00:00:00Z')};
    const proof = {schemaVersion: 1, artifact: context.artifactId, imageDigest: context.digest,
      sourceSha: context.sourceSha, cve: context.cve, conclusion: 'not_affected', passed: true,
      checks: [{name: 'Actual route and response probe', passed: true}], upstreamReferences: ['https://example.test/advisory']};
    const bytes = Buffer.from(JSON.stringify(proof));
    fs.writeFileSync(path.join(directory, 'proof.json'), bytes);
    const vex = {schemaVersion: 2, artifact: context.artifactId, imageDigest: context.digest, cve: context.cve,
      sourceSha: context.sourceSha, status: 'not_affected', reason: 'Affected endpoint absent in actual runtime',
      preparedBy: 'fixture-author', approvedBy: 'fixture-reviewer',
      approvalUrl: 'https://github.com/example/test/pull/1#pullrequestreview-1', trackingIssue: 'TEST-1',
      approvedAt: '2026-10-19T00:00:00Z', expiresAt: '2026-10-21T00:00:00Z',
      evidence: [{path: 'proof.json', sha256: crypto.createHash('sha256').update(bytes).digest('hex')}]};
    assert.equal(validateEvidenceVex(vex, context), true);
    for (const change of [
      {imageDigest: 'sha256:'+'c'.repeat(64)}, {sourceSha: 'd'.repeat(40)}, {approvedBy: ''},
      {approvedBy: 'FIXTURE-AUTHOR'}, {approvalUrl: ''}, {expiresAt: '2026-10-19T01:00:00Z'},
      {approvedAt: '2026-10-21T00:00:00Z'}, {evidence: []}, {status: 'unknown'},
      {evidence: [{path: '../outside.json', sha256: 'e'.repeat(64)}]},
      {evidence: [{path: 'proof.json', sha256: 'e'.repeat(64)}]}
    ]) assert.equal(validateEvidenceVex({...vex, ...change}, context), false, JSON.stringify(change));
    assert.equal(validateEvidenceVex(vex, {...context, sourceSha: undefined}), false);
    for (const change of [{imageDigest: 'sha256:'+'c'.repeat(64)}, {sourceSha: 'd'.repeat(40)},
      {passed: false}, {checks: []}, {checks: [{name: 'Failed probe', passed: false}]}, {upstreamReferences: []}]) {
      const changed = Buffer.from(JSON.stringify({...proof, ...change})); fs.writeFileSync(path.join(directory, 'proof.json'), changed);
      const changedVex = {...vex, evidence: [{path: 'proof.json', sha256: crypto.createHash('sha256').update(changed).digest('hex')}]};
      assert.equal(validateEvidenceVex(changedVex, context), false, JSON.stringify(change));
    }
    const fixed = Buffer.from(JSON.stringify({...proof, conclusion: 'fixed', fixCommit: 'f'.repeat(40), fixIsAncestor: true}));
    fs.writeFileSync(path.join(directory, 'proof.json'), fixed);
    assert.equal(validateEvidenceVex({...vex, status: 'fixed', evidence: [{path: 'proof.json', sha256: crypto.createHash('sha256').update(fixed).digest('hex')}]}, context), true);
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
});
