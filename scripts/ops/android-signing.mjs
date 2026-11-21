import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {readFileSync, lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {args, main, run, report, fail, repository} from './common.mjs';
import {normalizeCertificate, androidApps} from '../ci/verify-android-release.mjs';
import {collectSnapshot, evaluatePreflight} from '../ci/release-readiness-preflight.mjs';

export function validateCertificate(pem, fingerprint, now = Date.now()) {
  const cert = new X509Certificate(pem);
  assert.equal(normalizeCertificate(cert.fingerprint256), normalizeCertificate(fingerprint), 'Keystore certificate differs from the approved fingerprint');
  assert.ok(Date.parse(cert.validFrom)<=now && Date.parse(cert.validTo)>now+365*86400000, 'Certificate must be valid for at least another year');
  assert.ok(!/Android Debug/i.test(cert.subject), 'Debug certificate is forbidden');
  assert.equal(cert.publicKey.asymmetricKeyType, 'rsa', 'This release setup requires an RSA signing key');
  assert.ok(cert.publicKey.asymmetricKeyDetails.modulusLength>=2048, 'RSA key must be at least 2048 bits');
  return {certificateSha256:normalizeCertificate(cert.fingerprint256), validTo:cert.validTo};
}
export function secretNames(app) {
  assert.ok(Object.hasOwn(androidApps,app), 'Use app client or glass');
  return ['KEYSTORE_BASE64','STORE_PASSWORD','KEY_ALIAS','KEY_PASSWORD'].map(name=>`IOT_${app.toUpperCase()}_RELEASE_${name}`);
}
export function configureSigning(options, command, execute=run) {
  assert.ok(['check','configure'].includes(command));
  const app=options.app; secretNames(app);
  const lastCode=Number(options['last-version-code']);
  assert.match(options['last-version-code']??'', /^(0|[1-9][0-9]{0,9})$/);
  assert.ok(lastCode<2100000000, 'Invalid previous distributed versionCode');
  const file=resolve(options.keystore??'');
  const stat=lstatSync(file); assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<32768, 'Invalid keystore file');
  if(process.platform!=='win32')assert.equal(stat.mode&0o077,0,'Keystore must be private (chmod 600)');
  for(const name of ['IOT_RELEASE_STORE_PASSWORD','IOT_RELEASE_KEY_ALIAS','IOT_RELEASE_KEY_PASSWORD'])assert.ok(process.env[name], `Missing ${name}`);
  const keytool=process.env.JAVA_HOME?resolve(process.env.JAVA_HOME,'bin',process.platform==='win32'?'keytool.exe':'keytool'):'keytool';
  const base=['-keystore',file,'-storepass:env','IOT_RELEASE_STORE_PASSWORD','-alias',process.env.IOT_RELEASE_KEY_ALIAS];
  // keytool certreq may ignore a PKCS12 key password; use KeyStore.getKey and
  // a challenge signature to prove both passwords and possession of the key.
  const java=process.env.JAVA_HOME?resolve(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';
  assert.equal(execute(java,[fileURLToPath(new URL('./VerifyAndroidSigning.java',import.meta.url)),file]).trim(),'PRIVATE_KEY_VERIFIED');
  const certificate=validateCertificate(execute(keytool,['-exportcert','-rfc',...base]),options['cert-sha256']);
  if(command==='configure') {
    const repo=repository(options.repository), governance=evaluatePreflight(collectSnapshot(repo));
    assert.equal(governance.status,'PASS','Complete protected environments, independent reviews and runner before uploading signing secrets');
    const values=[readFileSync(file).toString('base64'),process.env.IOT_RELEASE_STORE_PASSWORD,process.env.IOT_RELEASE_KEY_ALIAS,process.env.IOT_RELEASE_KEY_PASSWORD];
    // No secret argument, disk bundle, shell expansion, or secret value in reports.
    secretNames(app).forEach((name,i)=>execute('gh',['secret','set',name,'--repo',repo,'--env','android-release'],{input:values[i]}));
    for(const [name,value] of [[`ANDROID_${app.toUpperCase()}_CERT_SHA256`,certificate.certificateSha256],
      [`ANDROID_${app.toUpperCase()}_LAST_RELEASE_VERSION_CODE`,String(lastCode)]])execute('gh',['variable','set',name,'--repo',repo,'--env','android-release','--body',value]);
  }
  return {status:command==='configure'?'CONFIGURED':'CHECKED',productionApproved:false,app,...certificate,lastVersionCode:lastCode,secrets:secretNames(app)};
}
if(main(import.meta.url))try {const {command,options}=args(); report(options.output,configureSigning(options,command));}catch(error){fail(error);}
