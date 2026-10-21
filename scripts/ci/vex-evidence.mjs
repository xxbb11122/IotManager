import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const exactDigest = value => /^sha256:[0-9a-f]{64}$/.test(value || '');

// This validates a reviewed record's integrity. Repository protection and the
// referenced independent GitHub review still establish approval authority.
export function validateEvidenceVex(vex, {directory, artifactId, digest, cve, sourceSha, now = Date.now()}) {
  try {
    if (vex.schemaVersion !== 2 || !['not_affected', 'fixed'].includes(vex.status)
        || vex.artifact !== artifactId || !exactDigest(vex.imageDigest) || vex.imageDigest !== digest
        || !cve || vex.cve !== cve || !/^[0-9a-f]{40}$/.test(sourceSha || '') || vex.sourceSha !== sourceSha
        || !nonempty(vex.reason) || !nonempty(vex.preparedBy) || !nonempty(vex.approvedBy)
        || vex.preparedBy.trim().toLowerCase() === vex.approvedBy.trim().toLowerCase()
        || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+#pullrequestreview-\d+$/.test(vex.approvalUrl || '')
        || !nonempty(vex.trackingIssue)) return false;
    const approved = Date.parse(vex.approvedAt || ''), expires = Date.parse(vex.expiresAt || '');
    if (!Number.isFinite(approved) || !Number.isFinite(expires) || approved > now || expires <= now || expires <= approved) return false;
    if (!Array.isArray(vex.evidence) || vex.evidence.length === 0) return false;
    const base = fs.realpathSync(directory);
    for (const item of vex.evidence) {
      if (!nonempty(item.path) || path.isAbsolute(item.path) || !/^[0-9a-f]{64}$/.test(item.sha256 || '')) return false;
      const file = fs.realpathSync(path.resolve(base, item.path));
      const relative = path.relative(base, file);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !fs.statSync(file).isFile()) return false;
      const bytes = fs.readFileSync(file);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) return false;
      const proof = JSON.parse(bytes);
      if (proof.schemaVersion !== 1 || proof.artifact !== artifactId || proof.imageDigest !== digest
          || proof.sourceSha !== sourceSha || proof.cve !== cve || proof.conclusion !== vex.status
          || proof.passed !== true || !Array.isArray(proof.checks) || proof.checks.length === 0
          || !proof.checks.every(check => nonempty(check.name) && check.passed === true)
          || !Array.isArray(proof.upstreamReferences) || proof.upstreamReferences.length === 0
          || !proof.upstreamReferences.every(url => /^https:\/\//.test(url))) return false;
      if (vex.status === 'fixed' && (!/^[0-9a-f]{40}$/.test(proof.fixCommit || '') || proof.fixIsAncestor !== true)) return false;
    }
    return true;
  } catch { return false; }
}
