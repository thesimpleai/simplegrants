// Test-only concurrent RPC regression against the disposable local container.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const container = process.argv[2];
if (!/^simple-grant-db-test-\d+$/.test(container ?? '')) throw new Error('Requires the disposable test container');
const hash = (value) => createHash('sha256').update(`synthetic-test:${value}`).digest('hex');
function sql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt']);
    let output = ''; let error = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(error)));
    child.stdin.end(statement);
  });
}
let refusedSnapshot = false;
try {
  await sql(`begin isolation level repeatable read; set local role service_role; select simple_grant.claim_auth_email('${hash('snapshot-email')}','${hash('snapshot-ip')}'); commit;`);
} catch (error) {
  if (!String(error).includes('requires READ COMMITTED isolation')) throw error;
  refusedSnapshot = true;
}
if (!refusedSnapshot) throw new Error('Custom stale-snapshot isolation did not fail closed');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const successful = (outputs) => outputs.filter((output) => output.trim().split('\n').some((line) => uuid.test(line.trim()))).length;
const commonEmail = hash('concurrent-email');
const emailResults = await Promise.all(Array.from({ length: 12 }, (_, i) => sql(`begin; set local role service_role; select simple_grant.claim_auth_email('${commonEmail}','${hash(`email-ip-${i}`)}'); select pg_sleep(0.15); commit;`)));
if (successful(emailResults) !== 1) throw new Error('Concurrent email cooldown allowed more than one request');
const commonIp = hash('concurrent-ip');
const ipResults = await Promise.all(Array.from({ length: 25 }, (_, i) => sql(`begin; set local role service_role; select simple_grant.claim_auth_email('${hash(`ip-email-${i}`)}','${commonIp}'); select pg_sleep(0.04); commit;`)));
if (successful(ipResults) !== 20) throw new Error('Concurrent IP claims did not enforce exactly 20 requests');
await sql(`do $$begin
 if (select count(*) from simple_grant.auth_email_requests where email_hash='${commonEmail}') <> 1 then raise exception 'Concurrent cooldown stored extra events'; end if;
 if (select count(*) from simple_grant.auth_email_requests where ip_hash='${commonIp}') <> 20 then raise exception 'Concurrent IP limit stored extra events'; end if;
end$$;
delete from simple_grant.auth_email_requests where email_hash='${commonEmail}' or ip_hash='${commonIp}';`);
process.stdout.write('PASS: concurrent distinct-IP email requests allow 1/12; concurrent distinct-email IP requests allow 20/25.\n');
