import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,chmodSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomBytes,X509Certificate} from 'node:crypto';
import {run} from '../../ops/common.mjs';
import {validateCertificate,configureSigning} from '../../ops/android-signing.mjs';

test('actual private keystore, key password and certificate are validated without uploading secrets',()=>{
 const folder=mkdtempSync(join(tmpdir(),'iot-signing-setup-'));
 const keytool=process.env.JAVA_HOME?resolve(process.env.JAVA_HOME,'bin',process.platform==='win32'?'keytool.exe':'keytool'):'keytool';
 const names=['IOT_RELEASE_STORE_PASSWORD','IOT_RELEASE_KEY_ALIAS','IOT_RELEASE_KEY_PASSWORD'],before=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 try {
  const password=randomBytes(24).toString('hex'),file=join(folder,'lab.jks');
  process.env.IOT_RELEASE_STORE_PASSWORD=password;process.env.IOT_RELEASE_KEY_PASSWORD=password;process.env.IOT_RELEASE_KEY_ALIAS='laboratory';
  run(keytool,['-genkeypair','-storetype','PKCS12','-keystore',file,'-storepass:env','IOT_RELEASE_STORE_PASSWORD','-keypass:env','IOT_RELEASE_KEY_PASSWORD',
   '-alias','laboratory','-keyalg','RSA','-keysize','2048','-validity','3650','-dname','CN=IoT Laboratory Only, O=Simulation, C=CN']);
  chmodSync(file,0o600);
  const pem=run(keytool,['-exportcert','-rfc','-keystore',file,'-storepass:env','IOT_RELEASE_STORE_PASSWORD','-alias','laboratory']);
  const fingerprint=new X509Certificate(pem).fingerprint256;
  const result=configureSigning({app:'glass',keystore:file,'cert-sha256':fingerprint,'last-version-code':'24'},'check');
  assert.equal(result.status,'CHECKED');assert.equal(result.productionApproved,false);assert.ok(!JSON.stringify(result).includes(password));
  assert.throws(()=>validateCertificate(pem,'0'.repeat(64)),/approved fingerprint/);
  assert.throws(()=>validateCertificate(pem,fingerprint,Date.now()+4000*86400000),/at least another year/);
  process.env.IOT_RELEASE_KEY_PASSWORD='incorrect-lab-key-password';
  assert.throws(()=>configureSigning({app:'glass',keystore:file,'cert-sha256':fingerprint,'last-version-code':'24'},'check'),/private command output was withheld/);
 } finally {
  for(const name of names)if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name];
  assert.ok(realpathSync(folder).startsWith(realpathSync(tmpdir())+sep+'iot-signing-setup-'));rmSync(folder,{recursive:true});
 }
});
