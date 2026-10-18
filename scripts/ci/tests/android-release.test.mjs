import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAndroidIdentity,normalizeCertificate } from '../verify-android-release.mjs';
const sha='a'.repeat(40),cert='b'.repeat(64);
const valid=()=>({app:'glass',sourceSha:sha,versionCode:12,versionName:'1.1.5-glass.7',certificateSha256:cert,
  badging:"package: name='com.iot.manager.glassnext' versionCode='12' versionName='1.1.5-glass.7' platformBuildVersionName=''",
  xmlTree:'A: android:usesCleartextTraffic(0x010104ec)=(type 0x12)0x0\n',
  apkCertificates:`Signer #1 certificate DN: CN=Release\nSigner #1 certificate SHA-256 digest: ${cert}\n`,
  bundleVerification:'jar verified.\n',bundleCertificate:`SHA256: ${cert.match(/../g).join(':')}\n`,buildInfo:{commit:sha,dirty:false}});
test('signed APK/AAB identities bind to exact clean source, app and trusted certificate',()=>{
  assert.equal(validateAndroidIdentity(valid()).certificateSha256,cert);assert.equal(normalizeCertificate(cert.toUpperCase()),cert);
});
test('wrong source, signer, package, version, debug and unsigned bundles fail closed',()=>{
  for(const change of [v=>v.sourceSha='main',v=>v.app='../../client',v=>v.buildInfo.dirty=true,v=>v.buildInfo.commit='c'.repeat(40),
    v=>v.certificateSha256='c'.repeat(64),v=>v.badging=v.badging.replace('glassnext','client'),v=>v.versionCode=11,
    v=>v.badging+='\napplication-debuggable\n',v=>v.xmlTree=v.xmlTree.replace('0x0\n','0xffffffff\n'),
    v=>v.apkCertificates=v.apkCertificates.replace('CN=Release','CN=Android Debug'),v=>v.bundleVerification='jar is unsigned.',
    v=>v.bundleVerification+='contains unsigned entries',v=>v.bundleCertificate=`SHA256: ${'c'.repeat(64)}`,
    v=>v.apkCertificates+=`Signer #2 certificate SHA-256 digest: ${cert}\n`]){
    const input=valid();change(input);assert.throws(()=>validateAndroidIdentity(input));
  }
});
test('CI joins Glass Android, required UI regression and release safeguards',()=>{
  const read=path=>readFileSync(new URL('../../../'+path,import.meta.url),'utf8');
  const ci=read('.github/workflows/ci.yml'),gate=ci.slice(ci.indexOf('  quick-gate:'));
  assert.match(gate,/needs: \[[^\n]*android-glass-debug/);assert.match(gate,/GLASS_ANDROID_RESULT:/);assert.match(gate,/"\$GLASS_ANDROID_RESULT"/);
  for(const path of ['scripts/verify.sh','scripts/verify.ps1'])assert.match(read(path),/e2e\/material-contract\.spec\.js/);
  const workflow=read('.github/workflows/android-release.yml');
  assert.match(workflow,/environment: android-release/);assert.match(workflow,/merge-base --is-ancestor/);
  assert.match(workflow,/release-readiness-preflight\.mjs/);assert.match(workflow,/verify-android-release\.mjs/);
  assert.ok(!workflow.includes('pull_request_target:'));assert.ok(!workflow.includes('packages: write'));
});
