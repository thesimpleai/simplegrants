-- Test-only reproduction of the THREE exact Storage policies supplied by user.
-- No production policy is changed. Load shared-project-common.sql first.
CREATE POLICY "Allow authenticated downloads" ON storage.objects
AS PERMISSIVE FOR SELECT TO authenticated
USING ((bucket_id = 'pdfs'::text) AND (auth.role() = 'authenticated'::text));

CREATE POLICY "Allow authenticated uploads" ON storage.objects
AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK ((bucket_id = 'pdfs'::text) AND (auth.role() = 'authenticated'::text));

CREATE POLICY finance_evidence_server_only ON storage.objects
AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (bucket_id <> 'finance-evidence'::text)
WITH CHECK (bucket_id <> 'finance-evidence'::text);
