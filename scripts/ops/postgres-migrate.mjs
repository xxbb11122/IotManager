import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream,existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {resolve,join} from 'node:path';
import {args,main,run,report,fail} from './common.mjs';

const marker='pg16-musl-alpine3.24-v1';
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const identifier=value=>'"'+value.replaceAll('"','""')+'"';
export function validateMigration(config) {
  assert.match(config.id??'',/^[a-z0-9][a-z0-9-]{2,63}$/);
  assert.match(config.adminUser??'',/^[a-z_][a-z0-9_]{0,62}$/);
  for(const name of ['sourceContainer','targetContainer'])assert.match(config[name]??'',/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/);
  assert.notEqual(config.sourceContainer,config.targetContainer,'Source and target must differ');
  assert.match(config.sourceImageId??'',/^sha256:[a-f0-9]{64}$/);
  assert.match(config.targetImage??'',/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  assert.ok(Array.isArray(config.databases)&&config.databases.length>0);
  assert.equal(new Set(config.databases).size,config.databases.length);
  for(const db of config.databases)assert.match(db,/^[a-z_][a-z0-9_]{0,62}$/);
  assert.ok(!config.databases.some(db=>['postgres','template0','template1'].includes(db)));
  for(const field of ['oldBackupPrefix','newBackupPrefix'])assert.match(config[field]??'',/^s3:\/\/[a-z0-9.-]+\/[a-zA-Z0-9/_-]+\/?$/);
  const old=config.oldBackupPrefix.replace(/\/+$/,'')+'/',next=config.newBackupPrefix.replace(/\/+$/,'')+'/';
  assert.ok(!old.startsWith(next)&&!next.startsWith(old),'New WAL chain must use a disjoint S3 prefix');
  return config;
}
export function assertTopology(config,source,target) {
  assert.equal(source.Id===target.Id,false,'Source and target resolve to the same container');
  assert.equal(source.Image,config.sourceImageId,'Source image changed');
  assert.equal(target.Config.Image,config.targetImage,'Target must use the selected immutable image');
  const dataMount=container=>container.Mounts.filter(m=>m.Destination==='/var/lib/postgresql/data');
  const a=dataMount(source),b=dataMount(target);
  assert.equal(a.length,1);assert.equal(b.length,1);
  assert.notEqual(a[0].Source,b[0].Source,'Source and target share PGDATA');
  const left=a[0].Source.replace(/\/+$/,'')+'/',right=b[0].Source.replace(/\/+$/,'')+'/';
  assert.ok(!left.startsWith(right)&&!right.startsWith(left),'Source and target PGDATA mounts overlap');
  assert.ok(['volume','bind'].includes(b[0].Type));
  assert.equal(source.State.Running,true);assert.equal(target.State.Running,true);
}
const docker=(...argv)=>run('docker',argv);
function psql(container,db,sql,admin='postgres') {
  return docker('exec','-i','--user','postgres',container,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U',admin,'-d',db,'-c',sql).trim();
}
const json=(container,db,sql,admin='postgres')=>JSON.parse(psql(container,db,sql,admin));
const selected=config=>config.databases.map(literal).join(',');
function noClients(config) {
  assert.equal(Number(psql(config.sourceContainer,'postgres',`SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND datname IN (${selected(config)})`,config.adminUser)),0,
    'Stop application, Keycloak and other database clients before migration; source is never modified by this tool');
  assert.equal(Number(psql(config.targetContainer,'postgres',`SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND datname IN (${selected(config)})`,config.adminUser)),0,
    'Target databases must remain offline during migration');
}
function hosts(config) {
  assertTopology(config,JSON.parse(docker('inspect',config.sourceContainer))[0],JSON.parse(docker('inspect',config.targetContainer))[0]);
  assert.equal(docker('exec','--user','postgres',config.targetContainer,'cat','/var/lib/postgresql/data/.iot-runtime-abi').trim(),marker);
  for(const host of [config.sourceContainer,config.targetContainer]) {
    assert.equal(Math.floor(Number(psql(host,'postgres','SHOW server_version_num',config.adminUser))/10000),16);
    const databases=json(host,'postgres',"SELECT coalesce(json_agg(datname ORDER BY datname),'[]') FROM pg_database WHERE NOT datistemplate AND datname<>'postgres'",config.adminUser);
    assert.deepEqual(databases,[...config.databases].sort(),'Inventory every application and authentication database');
  }
  noClients(config);
  assert.notEqual(psql(config.sourceContainer,'postgres','SELECT system_identifier FROM pg_control_system()',config.adminUser),
    psql(config.targetContainer,'postgres','SELECT system_identifier FROM pg_control_system()',config.adminUser),'Target must be a newly initialized physical cluster');
}
const rolesSql=`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY rolname),'[]') FROM (
 SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('role',p.rolname,'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) ORDER BY p.rolname),'[]')
 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid WHERE m.member=a.oid) AS memberships
 FROM pg_roles a WHERE rolname !~ '^pg_') r`;
const aclSql="(SELECT coalesce(jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY x.grantee::regrole::text,x.privilege_type),'[]') FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) x)";
function metadata(container,db,admin) {
  const database=json(container,db,`SELECT jsonb_build_object('name',datname,'owner',pg_get_userbyid(datdba),'encoding',pg_encoding_to_char(encoding),
    'collate',datcollate,'ctype',datctype,'provider',datlocprovider,'acl',${aclSql}) FROM pg_database d WHERE datname=current_database()`,admin);
  assert.ok(database.provider==='c'&&['C','POSIX','C.UTF-8','C.utf8'].includes(database.collate)&&['C','POSIX','C.UTF-8','C.utf8'].includes(database.ctype),
    'Non-C libc/ICU locale requires a separate reviewed collation migration; refusing automatic conversion');
  const aggregate=sql=>json(container,db,`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text COLLATE "C"),'[]') FROM (${sql}) x`,admin);
  return {database,
    extensions:aggregate('SELECT extname,extversion,pg_get_userbyid(extowner) AS owner FROM pg_extension'),
    relations:aggregate(`SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,pg_get_userbyid(c.relowner) AS owner,c.relacl::text AS acl,c.relrowsecurity,c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','S','v','m','f')`),
    schemas:aggregate("SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl::text AS acl FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema'"),
    routines:aggregate("SELECT p.oid::regprocedure::text AS name,pg_get_userbyid(p.proowner) AS owner,p.proacl::text AS acl,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND p.prokind<>'a'"),
    columns:aggregate("SELECT a.attrelid::regclass::text AS relation,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f')"),
    policies:aggregate("SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies"),
    largeObjectOwners:aggregate('SELECT oid,pg_get_userbyid(lomowner) AS owner,lomacl::text AS acl FROM pg_largeobject_metadata'),
    defaults:aggregate('SELECT pg_get_userbyid(defaclrole) AS role,n.nspname,defaclobjtype,defaclacl::text FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace'),
    constraints:aggregate("SELECT conname,conrelid::regclass::text AS relation,pg_get_constraintdef(oid) AS definition,convalidated FROM pg_constraint WHERE connamespace IN (SELECT oid FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema')"),
    indexes:aggregate("SELECT c.oid::regclass::text AS name,pg_get_indexdef(c.oid) AS definition,i.indisvalid,i.indisready FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'")};
}
async function transfer(argv,{file,input,hashOnly=false}={}) {
  const child=spawn('docker',argv,{windowsHide:true,stdio:[input?'pipe':'ignore','pipe','pipe']});
  const hash=createHash('sha256');let failed=false;
  child.stderr.on('data',()=>{}); // SQL errors may include private row data.
  const completion=new Promise((yes,no)=>{child.once('error',no);child.once('close',code=>code===0?yes():no(new Error('Database stream failed; private output was withheld')));});
  const stdin=input?pipeline(createReadStream(input),child.stdin):Promise.resolve();
  const stdout=hashOnly?(async()=>{for await(const chunk of child.stdout)hash.update(chunk);})():pipeline(child.stdout,createWriteStream(file,{flags:'wx',mode:0o600}));
  try {await Promise.all([completion,stdin,stdout]);}catch(error){failed=true;child.kill();throw error;}
  assert.equal(failed,false);
  return hashOnly?hash.digest('hex'):digest(file);
}
async function digest(file) {const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function inventory(config,host) {
  const databases={};
  for(const db of config.databases) {
    const meta=metadata(host,db,config.adminUser),data={};
    assert.ok(meta.indexes.every(index=>index.indisvalid&&index.indisready),'Invalid or incomplete index requires repair before migration');
    for(const table of meta.relations.filter(r=>['r','p','m','S'].includes(r.kind))) {
      const name=identifier(table.schema)+'.'+identifier(table.name);
      // C byte ordering and fixed UTC settings make cross-libc comparison deterministic.
      const relation=table.kind==='S'?`(SELECT last_value,is_called FROM ${name})`:name;
      const query=`SET TIME ZONE 'UTC'; SET DateStyle='ISO, YMD'; SET extra_float_digits=3; COPY (SELECT row_to_json(t)::text FROM ${relation} t ORDER BY row_to_json(t)::text COLLATE "C") TO STDOUT`;
      data[name]=await transfer(['exec','--user','postgres',host,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',config.adminUser,'-d',db,'-c',query],{hashOnly:true});
    }
    data.largeObjects=await transfer(['exec','--user','postgres',host,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',config.adminUser,'-d',db,'-c',
      "COPY (SELECT loid,pageno,encode(data,'hex') FROM pg_largeobject ORDER BY loid,pageno) TO STDOUT"],{hashOnly:true});
    databases[db]={...meta,data};
  }
  return {roles:json(host,'postgres',rolesSql,config.adminUser),databases};
}
export function sameInventory(source,target) { assert.deepEqual(target,source,'Database data, sequences, large objects, ownership, ACL, roles, extensions or indexes differ'); }
function withoutDrillSchema(value) {
  const copy=structuredClone(value);
  for(const db of Object.values(copy.databases)) {
    for(const [key,rows] of Object.entries(db))if(Array.isArray(rows))db[key]=rows.filter(row=>
      row.schema!=='r1_recovery_drill' && row.nspname!=='r1_recovery_drill' && row.schemaname!=='r1_recovery_drill' &&
      !String(row.relation??'').startsWith('r1_recovery_drill.') && !String(row.name??'').startsWith('r1_recovery_drill.'));
    for(const key of Object.keys(db.data))if(key.startsWith('"r1_recovery_drill".'))delete db.data[key];
  }
  return copy;
}
export async function verifyRecoveredMigration(config,folder,recoveredContainer) {
  const exported=JSON.parse(readFileSync(join(resolve(folder),'migration.json'),'utf8'));
  assert.deepEqual(exported.config,config);
  sameInventory(withoutDrillSchema(exported.source),withoutDrillSchema(await inventory(config,recoveredContainer)));
  return {businessDataVerified:true,excludedSchema:'r1_recovery_drill'};
}
function emptyTargets(config) {
  for(const db of config.databases)assert.equal(Number(psql(config.targetContainer,db,"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','S','v','m','f')",config.adminUser)),0,'Target database must be empty; no automatic clean/drop is permitted');
}
export async function migrate(config,command,folder) {
  validateMigration(config); assert.ok(['inspect','export','restore','verify'].includes(command));
  hosts(config);
  if(command==='inspect')return {status:'INSPECTED',productionApproved:false,id:config.id,source:await inventory(config,config.sourceContainer),target:await inventory(config,config.targetContainer)};
  assert.equal(process.env.IOT_PG_MIGRATION_CONFIRM,config.id,'Set IOT_PG_MIGRATION_CONFIRM to the reviewed migration id after stopping writers');
  const root=resolve(folder);
  if(command==='export') {
    emptyTargets(config);
    assert.ok(!existsSync(root),'Use a new private export directory');mkdirSync(root,{mode:0o700});
    const source=await inventory(config,config.sourceContainer),dumpHashes={};
    for(const db of config.databases)dumpHashes[db]=await transfer(['exec','--user','postgres',config.sourceContainer,'pg_dump','-U',config.adminUser,'-d',db,'--format=custom','--lock-wait-timeout=10s'],{file:join(root,db+'.dump')});
    noClients(config);sameInventory(source,await inventory(config,config.sourceContainer));
    writeFileSync(join(root,'migration.json'),JSON.stringify({schemaVersion:1,config,source,dumpHashes},null,2)+'\n',{mode:0o600,flag:'wx'});
    return {status:'EXPORTED',productionApproved:false,id:config.id,databases:config.databases,dumpHashes};
  }
  assert.ok(lstatSync(root).isDirectory()&&!lstatSync(root).isSymbolicLink());
  assert.equal(lstatSync(root).mode&0o077,0,'Export directory must have mode 0700');
  const exported=JSON.parse(readFileSync(join(root,'migration.json'),'utf8'));
  assert.deepEqual(exported.config,config,'Migration configuration changed after export');
  for(const db of config.databases)assert.equal(await digest(join(root,db+'.dump')),exported.dumpHashes[db],'Dump checksum mismatch');
  sameInventory(exported.source,await inventory(config,config.sourceContainer));
  if(command==='restore') {
    emptyTargets(config);
    assert.ok(!existsSync(join(root,'restore.started')),'Restore already attempted; use a new clean target and export id');
    assert.deepEqual(json(config.targetContainer,'postgres',rolesSql,config.adminUser),exported.source.roles,'Provision matching least-privilege roles with new protected passwords before restore');
    for(const db of config.databases)assert.deepEqual(metadata(config.targetContainer,db,config.adminUser).database,exported.source.databases[db].database,
      'Target database owner, locale and database-level ACL must match the reviewed source inventory');
    closeSync(openSync(join(root,'restore.started'),'wx',0o600));
    for(const db of config.databases) {
      await transfer(['exec','-i','--user','postgres',config.targetContainer,'pg_restore','-U',config.adminUser,'-d',db,'--exit-on-error','--single-transaction'],
        {input:join(root,db+'.dump'),hashOnly:true});
      psql(config.targetContainer,db,'ANALYZE',config.adminUser);
    }
  }
  noClients(config);
  sameInventory(exported.source,await inventory(config,config.sourceContainer));
  sameInventory(exported.source,await inventory(config,config.targetContainer));
  return {status:'DATA_VERIFIED_BACKUP_PENDING',productionApproved:false,id:config.id,databases:config.databases,dumpHashes:exported.dumpHashes,
    newBackupPrefix:config.newBackupPrefix,requiredNext:['Configure the disjoint new S3 prefix and create a WAL-G full backup.',
      'Run Protected WAL-G Recovery Drill against this new source and retain its evidence.',
      'Perform application smoke checks, then approve the traffic switch. Old-volume rollback after new writes requires data reconciliation.'],
    sourceModified:false,trafficSwitched:false,oldVolumeRemoved:false};
}
if(main(import.meta.url))try {
  assert.equal(process.platform,'linux','Run migration on the dedicated Linux host');
  const {command,options}=args(),config=JSON.parse(readFileSync(options.config,'utf8'));
  report(options.output,await migrate(config,command,options.directory??''));
}catch(error){fail(error);}
