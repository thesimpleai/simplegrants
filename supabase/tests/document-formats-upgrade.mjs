// Test-only005->006 regression inside a disposable, network-isolated container.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const container=process.argv[2];
if(!/^simple-grant-db-test-\d+$/.test(container??''))throw new Error('Requires disposable test container');
const upgrade=readFileSync(fileURLToPath(new URL('../migrations/202611100006_document_formats.sql',import.meta.url)),'utf8');
function query(input,expectedError){
 const result=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-qAt'],{input,encoding:'utf8'});
 if(expectedError){if(result.status===0||!result.stderr.includes(expectedError))throw new Error(`Expected guard ${expectedError}; got ${result.stderr}`);return;}
 if(result.status!==0)throw new Error(result.stderr||String(result.error));return result.stdout.trim();
}
const original=['application/pdf','image/jpeg','image/png','image/webp','text/plain'];
const sqlArray=(values)=>`array[${values.map(value=>`'${value.replaceAll("'","''")}'`).join(',')}]`;
const bucket=()=>JSON.parse(query("select to_jsonb(b) from storage.buckets b where id='simple-grant-documents';")||'null');
const reference=bucket();
if(!reference||reference.public!==false||reference.allowed_mime_types.length!==5)throw new Error('Expected pristine005 bucket');
query("delete from storage.buckets where id='simple-grant-documents';");
query(upgrade,'documents bucket is missing');
if(bucket()!==null)throw new Error('Missing bucket guard created a bucket');
query(`insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('simple-grant-documents','simple-grant-documents',false,10485760,${sqlArray(original)});`);
for(const [setup,message,expected] of [
 ["public=true",'must remain private',b=>b.public===true],
 ["file_size_limit=10485761",'must retain its 10 MiB limit',b=>b.file_size_limit===10485761],
 ["allowed_mime_types=null",'requires an existing finite MIME allowlist',b=>b.allowed_mime_types===null],
]){
 query(`update storage.buckets set ${setup} where id='simple-grant-documents';`);
 const before=bucket();query(upgrade,message);const after=bucket();
 if(!expected(after)||JSON.stringify(before)!==JSON.stringify(after))throw new Error('Failing upgrade changed bucket metadata');
 query(`update storage.buckets set public=false,file_size_limit=10485760,allowed_mime_types=${sqlArray(original)} where id='simple-grant-documents';`);
}
query(`insert into simple_grant.organizations(id,name,notification_frequency) values('80000000-0000-4000-8000-000000000006','Existing005 organisation','never');
insert into simple_grant.documents(id,org_id,name,storage_path,mime_type,size_bytes,extracted_text) values('70000000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000006','Existing evidence.pdf','80000000-0000-4000-8000-000000000006/existing.pdf','application/pdf',100,'Preserve existing evidence');
insert into storage.objects(bucket_id,name) values('simple-grant-documents','80000000-0000-4000-8000-000000000006/existing.pdf');
update storage.buckets set allowed_mime_types=allowed_mime_types||array['application/x-existing-extra'] where id='simple-grant-documents';`);
const documentBefore=query("select to_jsonb(d) from simple_grant.documents d where id='70000000-0000-4000-8000-000000000006';");
query(upgrade);
const extended=bucket();
if(extended.public!==false||extended.file_size_limit!==10485760||extended.allowed_mime_types.length!==14||!extended.allowed_mime_types.includes('application/x-existing-extra'))throw new Error('Upgrade failed to preserve configuration or existing MIME extra');
if(query("select to_jsonb(d) from simple_grant.documents d where id='70000000-0000-4000-8000-000000000006';")!==documentBefore)throw new Error('Upgrade modified existing SG document');
if(query("select count(*) from storage.objects where bucket_id='simple-grant-documents' and name='80000000-0000-4000-8000-000000000006/existing.pdf';")!=='1')throw new Error('Upgrade removed existing object');
const version=query("select xmin::text from storage.buckets where id='simple-grant-documents';");
query(upgrade);
if(JSON.stringify(bucket())!==JSON.stringify(extended)||query("select xmin::text from storage.buckets where id='simple-grant-documents';")!==version)throw new Error('Second006 run was not a no-op');
query("delete from storage.objects where bucket_id='simple-grant-documents' and name='80000000-0000-4000-8000-000000000006/existing.pdf';delete from simple_grant.organizations where id='80000000-0000-4000-8000-000000000006';");
process.stdout.write('PASS:005->006 preserves SG evidence/object/MIME extras;006 repeat is no-op; missing/public/wrong-size/null-list guards roll back unchanged.\n');
