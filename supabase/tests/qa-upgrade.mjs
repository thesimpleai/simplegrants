// Test-only combined006+007 upgrade on existing005 or006, never a hosted database.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const container=process.argv[2];
if(!/^simple-grant-db-test-\d+$/.test(container??''))throw new Error('Requires disposable test container');
const upgrade=readFileSync(fileURLToPath(new URL('../upgrade-qa.sql',import.meta.url)),'utf8');
function sql(input,expectedError){
 const result=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-qAt'],{input,encoding:'utf8'});
 if(expectedError){if(result.status===0||!result.stderr.includes(expectedError))throw new Error(`Expected ${expectedError}: ${result.stderr}`);return;}
 if(result.status!==0)throw new Error(result.stderr||String(result.error));return result.stdout.trim();
}
sql(`insert into simple_grant.organizations(id,name,type,notification_frequency,profile) values
 ('80000000-0000-4000-8000-000000000071','Existing real charity remains','Charity','never','{"keep":"approved charity"}'),
 ('80000000-0000-4000-8000-000000000072','Existing company remains','Company','never','{"keep":"approved company"}');
insert into simple_grant.documents(id,org_id,name,storage_path,mime_type,size_bytes) values
 ('70000000-0000-4000-8000-000000000071','80000000-0000-4000-8000-000000000071','Existing registration.pdf','80000000-0000-4000-8000-000000000071/registration.pdf','application/pdf',100);
insert into storage.objects(bucket_id,name) values('simple-grant-documents','80000000-0000-4000-8000-000000000071/registration.pdf');
update storage.buckets b set allowed_mime_types=(select array_agg(mime order by mime) from unnest(b.allowed_mime_types||array['application/x-retained-extra']) m(mime)) where id='simple-grant-documents';`);
const orgsBefore=sql("select jsonb_agg(to_jsonb(o) order by id) from simple_grant.organizations o where id in ('80000000-0000-4000-8000-000000000071','80000000-0000-4000-8000-000000000072');");
const bucketInitial=JSON.parse(sql("select jsonb_build_object('mimes',allowed_mime_types,'xmin',xmin::text) from storage.buckets where id='simple-grant-documents';"));
const docBefore=sql("select to_jsonb(d) from simple_grant.documents d where id='70000000-0000-4000-8000-000000000071';");
// Prove006 changes roll back if007 finds an incompatible column. The surrounding
// test changes are local fixture state; neither condition exists in the product.
sql('alter table simple_grant.organizations alter column type drop not null;');
const bucketBeforeFailure=sql("select to_jsonb(b) from storage.buckets b where id='simple-grant-documents';");
sql(upgrade,'column is missing or incompatible');
if(sql("select to_jsonb(b) from storage.buckets b where id='simple-grant-documents';")!==bucketBeforeFailure)throw new Error('006 committed despite007 failure');
sql('alter table simple_grant.organizations alter column type set not null;');
sql(upgrade);
if(bucketInitial.mimes.length===14 && sql("select xmin::text from storage.buckets where id='simple-grant-documents';")!==bucketInitial.xmin)throw new Error('Already-applied006 changed the bucket row');
if(sql("select jsonb_agg(to_jsonb(o) order by id) from simple_grant.organizations o where id in ('80000000-0000-4000-8000-000000000071','80000000-0000-4000-8000-000000000072');")!==orgsBefore)throw new Error('QA upgrade changed an existing organisation');
if(sql("select to_jsonb(d) from simple_grant.documents d where id='70000000-0000-4000-8000-000000000071';")!==docBefore)throw new Error('QA upgrade changed existing document');
if(sql("select count(*) from storage.objects where bucket_id='simple-grant-documents' and name='80000000-0000-4000-8000-000000000071/registration.pdf';")!=='1')throw new Error('QA upgrade changed existing storage object');
const beforeRepeat=sql("select jsonb_build_object('bucket',to_jsonb(b),'bucket_xmin',b.xmin::text,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid),'default_xmin',d.xmin::text) from storage.buckets b cross join pg_catalog.pg_attrdef d join pg_catalog.pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum join pg_catalog.pg_class c on c.oid=a.attrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where b.id='simple-grant-documents' and n.nspname='simple_grant' and c.relname='organizations' and a.attname='type';");
const parsed=JSON.parse(beforeRepeat);
if(parsed.default!=="''::text"||!parsed.bucket.allowed_mime_types.includes('application/x-retained-extra')||parsed.bucket.allowed_mime_types.length!==14)throw new Error('QA upgrade did not set future default or preserve MIME extra');
sql(upgrade);
const afterRepeat=sql("select jsonb_build_object('bucket',to_jsonb(b),'bucket_xmin',b.xmin::text,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid),'default_xmin',d.xmin::text) from storage.buckets b cross join pg_catalog.pg_attrdef d join pg_catalog.pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum join pg_catalog.pg_class c on c.oid=a.attrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where b.id='simple-grant-documents' and n.nspname='simple_grant' and c.relname='organizations' and a.attname='type';");
if(afterRepeat!==beforeRepeat)throw new Error('Repeated QA upgrade was not a no-op');
sql("delete from storage.objects where bucket_id='simple-grant-documents' and name='80000000-0000-4000-8000-000000000071/registration.pdf';delete from simple_grant.organizations where id in ('80000000-0000-4000-8000-000000000071','80000000-0000-4000-8000-000000000072');");
process.stdout.write('PASS: QA006+007 upgrade is atomic/idempotent; preserves existing Charity/Company records, evidence, object and MIME extras; future type default is unknown.\n');
