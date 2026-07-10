-- ═══════════════════════════════════════════════════════════════════════════
-- Incloo — Soporte para el PANEL DE EMPRESA (perfil.html)
-- Proyecto: pcvfwlbefnwwexhaenph
--
-- CÓMO EJECUTARLO:
--   Dashboard → SQL Editor → New query → pegar TODO → Run
--
-- Añade: foto de perfil de empresa, borrado de ofertas por su empresa, y
-- reasegura la tabla de candidaturas (por si el setup grande no se aplicó).
-- Es idempotente: se puede ejecutar varias veces sin romper nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Foto de perfil / logo de la empresa
alter table public.companies add column if not exists logo_url    text;
alter table public.companies add column if not exists descripcion text;

-- 2) Una empresa puede BORRAR sus propias ofertas (antes no había política de
--    delete, por eso no se podían eliminar desde la web ni con el cliente).
drop policy if exists "Empresa borra sus ofertas" on public.jobs;
create policy "Empresa borra sus ofertas"
  on public.jobs for delete
  to authenticated
  using (company_id = auth.uid());

-- 3) Candidaturas: asegurar tabla + permisos (por si no se crearon)
create table if not exists public.applications (
  id            bigserial primary key,
  created_at    timestamptz default now(),
  job_id        bigint references public.jobs(id) on delete set null,
  job_title     text,
  company_name  text,
  company_email text,
  nombre        text not null,
  email         text not null,
  telefono      text,
  discapacidad  text,
  carta         text,
  cv_url        text
);

alter table public.applications enable row level security;

-- Cualquiera (candidato anónimo) puede enviar su candidatura
drop policy if exists "Candidato puede enviar candidatura" on public.applications;
create policy "Candidato puede enviar candidatura"
  on public.applications for insert
  to anon
  with check (true);

-- Cada empresa ve SOLO las candidaturas de SUS ofertas
drop policy if exists "Empresa ve candidaturas de sus ofertas" on public.applications;
create policy "Empresa ve candidaturas de sus ofertas"
  on public.applications for select
  to authenticated
  using (exists (
    select 1 from public.jobs j
    where j.id = applications.job_id
      and j.company_id = auth.uid()
  ));

-- Una empresa puede borrar candidaturas de sus ofertas
drop policy if exists "Empresa borra candidaturas de sus ofertas" on public.applications;
create policy "Empresa borra candidaturas de sus ofertas"
  on public.applications for delete
  to authenticated
  using (exists (
    select 1 from public.jobs j
    where j.id = applications.job_id
      and j.company_id = auth.uid()
  ));

create index if not exists applications_job_id_idx     on public.applications (job_id);
create index if not exists applications_created_at_idx on public.applications (created_at desc);

-- 4) Bucket público para las fotos de perfil de empresa
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict do nothing;

-- NOTA: si estas políticas de storage fallan con "must be owner of table objects"
-- (pasa en proyectos nuevos), créalas desde el Dashboard:
--   Storage → logos → Policies → New policy:
--     · INSERT y UPDATE para rol authenticated con expresión:  bucket_id = 'logos'
--     · SELECT para rol anon con expresión:                    bucket_id = 'logos'
drop policy if exists "Empresa sube su logo" on storage.objects;
create policy "Empresa sube su logo"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'logos');

drop policy if exists "Empresa actualiza su logo" on storage.objects;
create policy "Empresa actualiza su logo"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'logos');

drop policy if exists "Logo es de lectura pública" on storage.objects;
create policy "Logo es de lectura pública"
  on storage.objects for select
  to anon
  using (bucket_id = 'logos');
