begin;

create table if not exists public.frontboard_storage_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_version text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, consent_version)
);

create table if not exists public.frontboard_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_document text not null,
  uploaded_at timestamptz not null default now(),
  file_extension text not null check (file_extension in ('pdf', 'csv', 'json', 'txt')),
  record_count integer not null check (record_count >= 0),
  original_path text not null,
  record_path text not null
);

create index if not exists frontboard_documents_user_uploaded_idx
  on public.frontboard_documents (user_id, uploaded_at desc);

alter table public.frontboard_storage_consents enable row level security;
alter table public.frontboard_documents enable row level security;

grant select, insert on public.frontboard_storage_consents to authenticated;
grant select, insert, delete on public.frontboard_documents to authenticated;

drop policy if exists "FrontBoard users read own storage consent"
  on public.frontboard_storage_consents;
create policy "FrontBoard users read own storage consent"
  on public.frontboard_storage_consents for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "FrontBoard users record own storage consent"
  on public.frontboard_storage_consents;
create policy "FrontBoard users record own storage consent"
  on public.frontboard_storage_consents for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "FrontBoard users read own document metadata"
  on public.frontboard_documents;
create policy "FrontBoard users read own document metadata"
  on public.frontboard_documents for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "FrontBoard users add own document metadata after consent"
  on public.frontboard_documents;
create policy "FrontBoard users add own document metadata after consent"
  on public.frontboard_documents for insert to authenticated
  with check (
    auth.uid() = user_id
    and original_path like ('users/' || auth.uid()::text || '/FrontBoard/%')
    and record_path like ('users/' || auth.uid()::text || '/FrontBoard/%')
    and exists (
      select 1
      from public.frontboard_storage_consents consent
      where consent.user_id = auth.uid()
        and consent.consent_version = '1'
    )
  );

drop policy if exists "FrontBoard users delete own document metadata"
  on public.frontboard_documents;
create policy "FrontBoard users delete own document metadata"
  on public.frontboard_documents for delete to authenticated
  using (auth.uid() = user_id);

update storage.buckets
set public = false,
    file_size_limit = 15728640,
    allowed_mime_types = array['application/pdf', 'text/csv', 'application/json', 'text/plain']
where id = 'frontboard-private';

drop policy if exists "FrontBoard users read own private files" on storage.objects;
create policy "FrontBoard users read own private files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'frontboard-private'
    and name like ('users/' || auth.uid()::text || '/FrontBoard/%')
  );

drop policy if exists "FrontBoard users upload own files after consent" on storage.objects;
create policy "FrontBoard users upload own files after consent"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'frontboard-private'
    and name like ('users/' || auth.uid()::text || '/FrontBoard/%')
    and exists (
      select 1
      from public.frontboard_storage_consents consent
      where consent.user_id = auth.uid()
        and consent.consent_version = '1'
    )
  );

drop policy if exists "FrontBoard users delete own files" on storage.objects;
create policy "FrontBoard users delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'frontboard-private'
    and name like ('users/' || auth.uid()::text || '/FrontBoard/%')
  );

commit;
