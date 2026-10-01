-- Migration 202610010006: Ensure storage bucket oath-proofs is public and accessible for chat & proof uploads

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'oath-proofs',
  'oath-proofs',
  true,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'];

DROP POLICY IF EXISTS "Anyone can view oath-proofs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload oath-proofs" ON storage.objects;
DROP POLICY IF EXISTS "Public read for oath-proofs" ON storage.objects;

CREATE POLICY "Anyone can view oath-proofs"
ON storage.objects FOR SELECT
USING (bucket_id = 'oath-proofs');

CREATE POLICY "Authenticated users can upload oath-proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'oath-proofs');
