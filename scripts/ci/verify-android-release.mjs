import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const androidApps = {client:{path:'client',id:'com.iot.manager.client'},glass:{path:'apps/client-glass-next',id:'com.iot.manager.glassnext'}};
export function normalizeCertificate(value) {
  const text=String(value??'').replaceAll(':','').trim().toLowerCase();
  assert.match(text,/^[a-f0-9]{64}$/,'A trusted SHA256 signing certificate fingerprint is required');return text;
}

/** Validate output from the real SDK tools, not a caller-provided pass boolean. */
export function validateAndroidIdentity({app,sourceSha,versionCode,versionName,certificateSha256,badging,xmlTree,apkCertificates,bundleVerification,bundleCertificate,buildInfo}) {
  assert.ok(Object.hasOwn(androidApps,app),'Unsupported Android app');
  assert.match(sourceSha,/^[a-f0-9]{40}$/,'A full source SHA is required');
  assert.ok(Number.isInteger(versionCode)&&versionCode>0&&versionCode<=2100000000,'Invalid versionCode');
  assert.match(versionName,/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/,'Invalid versionName');
  const trusted=normalizeCertificate(certificateSha256);
  const identity=badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
  assert.ok(identity,'APK package identity is unreadable');
  assert.equal(identity[1],androidApps[app].id,'APK applicationId mismatch');
  assert.equal(Number(identity[2]),versionCode,'APK versionCode mismatch');assert.equal(identity[3],versionName,'APK versionName mismatch');
  assert.ok(!/^application-debuggable/m.test(badging)&&!/android:debuggable[^\n]*0xffffffff/i.test(xmlTree),'Debuggable APK is forbidden');
  assert.match(xmlTree,/android:usesCleartextTraffic[^\n]*\(type 0x12\)0x0(?:\s|$)/,'Release must explicitly reject cleartext traffic');
  assert.ok(!/Android Debug/i.test(apkCertificates),'Android debug signing key is forbidden');
  const certificates=[...apkCertificates.matchAll(/^Signer #\d+ certificate SHA-256 digest:\s*([a-f0-9:]+)\s*$/gmi)].map(value=>normalizeCertificate(value[1]));
  assert.equal(certificates.length,1,'Exactly one APK signer must be verified');assert.equal(certificates[0],trusted,'APK certificate mismatch');
  assert.match(bundleVerification,/jar verified\./i,'AAB signature was not verified');
  assert.ok(!/jar is unsigned|unsigned entries|not integrity-checked/i.test(bundleVerification),'AAB contains unsigned content');
  const bundleSigners=[...bundleCertificate.matchAll(/SHA256:\s*([a-f0-9:]+)/gi)].map(value=>normalizeCertificate(value[1]));
  assert.equal(bundleSigners.length,1,'Exactly one AAB certificate is required');assert.equal(bundleSigners[0],trusted,'AAB certificate mismatch');
  assert.equal(buildInfo.commit,sourceSha,'Embedded web source SHA mismatch');assert.equal(buildInfo.dirty,false,'Embedded web build must be clean');
  return {appId:identity[1],sourceSha,versionCode,versionName,certificateSha256:trusted,debuggable:false,cleartextTraffic:false};
}

if (process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2), get=flag=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
  const app=get('--app');assert.ok(Object.hasOwn(androidApps,app),'Use --app client or glass');
  const root=resolve(get('--root')??'.'), appRoot=resolve(root,androidApps[app].path);
  const sourceSha=get('--source-sha'), versionCode=Number(get('--version-code')),versionName=get('--version-name');
  const sdk=process.env.ANDROID_HOME??process.env.ANDROID_SDK_ROOT;assert.ok(sdk,'Android SDK is required');
  const toolRoot=resolve(sdk,'build-tools/36.0.0');
  const run=(command,argv,cwd=root)=>execFileSync(command,argv,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
  assert.equal(run('git',['rev-parse','HEAD']).trim(),sourceSha,'Checkout SHA mismatch');
  assert.equal(run('git',['status','--porcelain','--untracked-files=normal']).trim(),'','Release checkout is dirty');
  const apk=resolve(appRoot,'android/app/build/outputs/apk/release/app-release.apk');
  const aab=resolve(appRoot,'android/app/build/outputs/bundle/release/app-release.aab');
  const java=process.env.JAVA_HOME?resolve(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';
  const javaTool=name=>process.env.JAVA_HOME?resolve(process.env.JAVA_HOME,'bin',process.platform==='win32'?`${name}.exe`:name):name;
  const badging=run(resolve(toolRoot,process.platform==='win32'?'aapt.exe':'aapt'),['dump','badging',apk]);
  const xmlTree=run(resolve(toolRoot,process.platform==='win32'?'aapt.exe':'aapt'),['dump','xmltree',apk,'AndroidManifest.xml']);
  const apkCertificates=run(java,['-jar',resolve(toolRoot,'lib/apksigner.jar'),'verify','--verbose','--print-certs',apk]);
  const bundleVerification=run(javaTool('jarsigner'),['-J-Duser.language=en','-J-Duser.country=US','-verify',aab]);
  const bundleCertificate=run(javaTool('keytool'),['-J-Duser.language=en','-J-Duser.country=US','-printcert','-jarfile',aab]);
  const web=process.platform==='win32'?run('tar',['-xOf',apk,'assets/public/build-info.json']):run('unzip',['-p',apk,'assets/public/build-info.json']);
  const identity=validateAndroidIdentity({app,sourceSha,versionCode,versionName,certificateSha256:get('--cert-sha256'),badging,xmlTree,
    apkCertificates,bundleVerification,bundleCertificate,buildInfo:JSON.parse(web)});
  const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
  const manifest={schemaVersion:1,status:'VERIFIED_SIGNED_BUILD',productionApproved:false,verifiedAt:new Date().toISOString(),...identity,
    dirty:false,apkSha256:sha(apk),aabSha256:sha(aab),boundaries:['physical device acceptance pending','server release gate required','AAB upload certificate may differ from Google Play distribution certificate']};
  const output=get('--output');assert.ok(output,'Use --output for the identity manifest');writeFileSync(resolve(output),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify(manifest,null,2));
}
