import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {args,main,run,report,fail} from './common.mjs';
import {migrate} from './postgres-migrate.mjs';

// Reuse the actual base-backup + named-restore-point + WAL replay drill.
// This intentionally changes only the new cluster's drill marker schema.
export async function backupMigrated(config,options) {
  await migrate(config,'verify',options.directory);
  assert.match(options.project??'',/^[a-z0-9][a-z0-9_-]{0,62}$/);
  const release=resolve(options.release),envFile=resolve(options['env-file']);
  const paths={candidate:join(release,'release-candidate.json'),topology:join(release,'release-topology.json'),services:join(release,'release-services.json'),
    manifest:join(release,'image-digests.json'),images:join(release,'image-digests.env')};
  for(const file of Object.values(paths))readFileSync(file);
  const compose=['compose','--project-name',options.project,'--env-file',envFile,'--env-file',paths.images,
    '-f','deploy/docker-compose.yml','-f','deploy/docker-compose.immutable.yml'];
  const targetId=run('docker',[...compose,'ps','-q','postgres']).trim();
  const actual=JSON.parse(run('docker',['inspect',config.targetContainer]))[0];
  assert.equal(targetId,actual.Id,'Recovery source project is not the migrated target');
  const topology=JSON.parse(run('docker',[...compose,'--profile','application','config','--format','json']));
  for(const name of ['postgres','wal-g-backup','wal-g-archive']) {
    const service=topology.services[name];assert.equal(service.image,config.targetImage);
    if(name!=='postgres') {assert.equal(service.environment.WALG_STORAGE_MODE,'s3');assert.equal(service.environment.WALG_S3_PREFIX,config.newBackupPrefix);}
  }
  const output=resolve(options.output);mkdirSync(output,{recursive:false,mode:0o700});
  const recoveryProject=`iot-manager-migration-${config.id}`;
  const env={...process.env,IOT_COMPOSE_PROJECT:options.project,IOT_ENVIRONMENT_FILE:envFile,IOT_RECOVERY_PROJECT:recoveryProject,
    IOT_PITR_CONFIRM:'PITR',IOT_RECOVERY_REPORT_DIR:output};
  run('bash',['scripts/runtime/wal-recovery-drill.sh','--mode','immutable','--digest-manifest',paths.manifest,
    '--digest-env-file',paths.images,'--release-candidate',paths.candidate,'--release-topology',paths.topology,'--release-services',paths.services],{env});
  const evidence=JSON.parse(readFileSync(join(output,'report.json'),'utf8'));
  assert.equal(evidence.status,'passed');
  return {status:'MIGRATION_AND_NEW_CHAIN_VERIFIED',productionApproved:false,id:config.id,newBackupPrefix:config.newBackupPrefix,recoveryProject,
    report:join(output,'report.json'),next:'Retain protected release evidence and approve application smoke checks and traffic switch.'};
}
if(main(import.meta.url))try {
  const {command,options}=args();assert.equal(command,'run');
  const config=JSON.parse(readFileSync(options.config,'utf8'));
  report(undefined,await backupMigrated(config,options));
}catch(error){fail(error);}
