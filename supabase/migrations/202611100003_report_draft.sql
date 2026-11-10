-- Preserve the reviewed AI-assisted acquittal draft with the funded project.
begin;
alter table simple_grant.funded_projects
  add column report_draft jsonb not null default '{}'::jsonb
  check (jsonb_typeof(report_draft) = 'object');
commit;
