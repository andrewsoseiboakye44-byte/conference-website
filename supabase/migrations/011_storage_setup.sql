-- ============================================================
-- Migration 011: Setup conference-assets storage bucket and policies
-- Run this in your Supabase SQL Editor if you want native cloud
-- object storage in Supabase Storage.
-- ============================================================

-- 1. Create the bucket if it does not exist
insert into storage.buckets (id, name, public)
values ('conference-assets', 'conference-assets', true)
on conflict (id) do update set public = true;

-- 2. Allow public read access (for public page hero flyer & speaker photos)
drop policy if exists "Public Access to conference-assets" on storage.objects;
create policy "Public Access to conference-assets"
on storage.objects for select
using ( bucket_id = 'conference-assets' );

-- 3. Allow authenticated users (admins/ushers) to upload files
drop policy if exists "Authenticated users can upload conference-assets" on storage.objects;
create policy "Authenticated users can upload conference-assets"
on storage.objects for insert
to authenticated
with check ( bucket_id = 'conference-assets' );

-- 4. Allow authenticated users to update existing files
drop policy if exists "Authenticated users can update conference-assets" on storage.objects;
create policy "Authenticated users can update conference-assets"
on storage.objects for update
to authenticated
using ( bucket_id = 'conference-assets' );

-- 5. Allow authenticated users to delete files
drop policy if exists "Authenticated users can delete conference-assets" on storage.objects;
create policy "Authenticated users can delete conference-assets"
on storage.objects for delete
to authenticated
using ( bucket_id = 'conference-assets' );
