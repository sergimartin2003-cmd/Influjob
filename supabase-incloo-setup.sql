-- ═══════════════════════════════════════════════════════════════════════════
-- Incloo — Setup completo del proyecto Supabase
-- Proyecto: pcvfwlbefnwwexhaenph (https://pcvfwlbefnwwexhaenph.supabase.co)
--
-- CÓMO EJECUTARLO:
--   Dashboard → SQL Editor → New query → pegar TODO este archivo → Run
--
-- Este archivo sustituye a los antiguos supabase-schema.sql,
-- supabase-applications.sql, supabase-bot-migration.sql y fix-trigger-email.sql
-- (eran del proyecto anterior). Se puede volver a ejecutar sin romper nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0. Extensiones
create extension if not exists pg_net with schema extensions;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. EMPRESAS — perfil ligado a la cuenta de usuario (registro / login)
--    Cuando una empresa se registra en la web, sus datos acaban aquí.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.companies (
  id          uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz default now(),
  nombre      text not null default '',
  email       text,
  telefono    text,
  web         text,
  sector      text,
  descripcion text
);

alter table public.companies enable row level security;

drop policy if exists "Empresa lee su perfil" on public.companies;
create policy "Empresa lee su perfil"
  on public.companies for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Empresa crea su perfil" on public.companies;
create policy "Empresa crea su perfil"
  on public.companies for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "Empresa actualiza su perfil" on public.companies;
create policy "Empresa actualiza su perfil"
  on public.companies for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Al registrarse un usuario, se crea automáticamente su ficha de empresa
-- con los datos que rellenó en el formulario de registro (metadata del signup)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.companies (id, nombre, email, telefono, web, sector)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'empresa', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'telefono', ''),
    coalesce(new.raw_user_meta_data->>'web', ''),
    coalesce(new.raw_user_meta_data->>'sector', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. OFERTAS (jobs) — del formulario web, de empresas registradas y del bot
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.jobs (
  id                  bigserial primary key,
  created_at          timestamptz default now(),

  -- Empresa registrada que publicó la oferta (null si vino sin login o del bot)
  company_id          uuid references public.companies (id) on delete set null,

  -- Datos de empresa
  empresa             text not null,
  web_empresa         text,
  nombre_contacto     text,
  email_contacto      text,
  telefono_contacto   text,

  -- Datos del puesto
  puesto              text not null,
  ciudad              text,
  modalidad           text,          -- presencial | remoto | híbrido
  tipo_contrato       text,          -- Indefinido | Temporal | Prácticas | Freelance
  sector              text,
  salario             text,
  descripcion         text,
  requisitos          text,          -- una línea por requisito
  beneficios          text,          -- una línea por beneficio

  -- Inclusión
  certificado_minimo  text,          -- 33% | 45% | 65% | Sin mínimo
  discapacidad_tipos  text,          -- "física, auditiva, visual, ..."
  ajustes_razonables  text,          -- sí | no | en evaluación

  -- Origen (bot de scraping)
  fuente              text,          -- null = formulario web; "Adzuna" = bot
  external_id         text unique,
  source_url          text,

  -- Workflow
  estado              text default 'pendiente'  -- pendiente | publicada | rechazada
);

-- Auto-aprobación:
--  a) Oferta de formulario (fuente IS NULL): se publica si empresa + puesto +
--     email de contacto son válidos; si no, queda pendiente de revisión.
--  b) Oferta del bot (fuente IS NOT NULL): se respeta el estado que decidió
--     el scraper según sus palabras clave.
create or replace function public.auto_approve_job()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.fuente is not null then
    return new;
  end if;

  if (
    trim(coalesce(new.empresa, ''))        != '' and
    trim(coalesce(new.puesto, ''))         != '' and
    trim(coalesce(new.email_contacto, '')) != '' and
    new.email_contacto ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ) then
    new.estado := 'publicada';
  else
    new.estado := 'pendiente';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_approve_job on public.jobs;
create trigger trg_auto_approve_job
  before insert on public.jobs
  for each row execute function public.auto_approve_job();

-- Row Level Security
alter table public.jobs enable row level security;

-- Visitante anónimo puede enviar una oferta desde el formulario
-- (no puede hacerse pasar por el bot ni por una empresa registrada)
drop policy if exists "Cualquiera puede enviar oferta" on public.jobs;
create policy "Cualquiera puede enviar oferta"
  on public.jobs for insert
  to anon
  with check (fuente is null and company_id is null);

-- Empresa registrada publica ofertas ligadas a su cuenta
drop policy if exists "Empresa publica sus ofertas" on public.jobs;
create policy "Empresa publica sus ofertas"
  on public.jobs for insert
  to authenticated
  with check (fuente is null and company_id = auth.uid());

-- Todo el mundo ve solo las ofertas publicadas
drop policy if exists "Solo ofertas publicadas son visibles" on public.jobs;
create policy "Solo ofertas publicadas son visibles"
  on public.jobs for select
  to anon
  using (estado = 'publicada');

-- Empresa registrada ve además todas las suyas (también las pendientes)
drop policy if exists "Empresa ve sus ofertas" on public.jobs;
create policy "Empresa ve sus ofertas"
  on public.jobs for select
  to authenticated
  using (estado = 'publicada' or company_id = auth.uid());

-- Empresa registrada puede editar solo sus ofertas
drop policy if exists "Empresa edita sus ofertas" on public.jobs;
create policy "Empresa edita sus ofertas"
  on public.jobs for update
  to authenticated
  using (company_id = auth.uid())
  with check (company_id = auth.uid());

-- El bot inserta con la clave service_role (secreto SUPABASE_SERVICE_KEY en
-- GitHub Actions), que se salta RLS — no necesita política propia.

create index if not exists jobs_estado_idx      on public.jobs (estado);
create index if not exists jobs_created_at_idx  on public.jobs (created_at desc);
create index if not exists jobs_fuente_idx      on public.jobs (fuente);
create index if not exists jobs_external_id_idx on public.jobs (external_id);
create index if not exists jobs_company_id_idx  on public.jobs (company_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. CANDIDATURAS (applications) + notificación por email via Resend
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.applications (
  id            bigserial primary key,
  created_at    timestamptz default now(),
  job_id        bigint references public.jobs(id) on delete set null,
  -- Snapshot del puesto (por si se borra la oferta)
  job_title     text,
  company_name  text,
  company_email text,
  -- Datos del candidato
  nombre        text not null,
  email         text not null,
  telefono      text,
  discapacidad  text,
  carta         text,
  cv_url        text
);

alter table public.applications enable row level security;

drop policy if exists "Candidato puede enviar candidatura" on public.applications;
create policy "Candidato puede enviar candidatura"
  on public.applications for insert
  to anon
  with check (true);

-- Cada empresa solo ve las candidaturas de SUS ofertas
drop policy if exists "Empresa ve candidaturas de sus ofertas" on public.applications;
create policy "Empresa ve candidaturas de sus ofertas"
  on public.applications for select
  to authenticated
  using (exists (
    select 1 from public.jobs j
    where j.id = applications.job_id
      and j.company_id = auth.uid()
  ));

create index if not exists applications_job_id_idx     on public.applications (job_id);
create index if not exists applications_created_at_idx on public.applications (created_at desc);

-- Notificación por email al recibir una candidatura (via Resend + pg_net)
-- IMPORTANTE: sustituye la clave de Resend si has generado una nueva, y cuando
-- tengas dominio verificado cambia el destinatario por new.company_email.
create or replace function public.notify_company_application()
returns trigger
language plpgsql
security definer
as $$
declare
  v_resend_key  text := 're_Bt1pSbcY_74fLgwpToQStfwz4tXyn3eJX';
  v_from_email  text := 'Incloo <onboarding@resend.dev>';
  v_subject     text;
  v_body        text;
begin
  v_subject := 'Nueva candidatura — ' || coalesce(nullif(new.job_title,''), 'Incloo');

  v_body := '<h2 style="color:#1a3a6b">Nueva candidatura recibida</h2>'
    || '<p><strong>Puesto:</strong> ' || coalesce(new.job_title,'—') || '</p>'
    || '<p><strong>Nombre:</strong> ' || new.nombre || '</p>'
    || '<p><strong>Email:</strong> <a href="mailto:' || new.email || '">' || new.email || '</a></p>'
    || case when coalesce(new.telefono,'') != '' then '<p><strong>Teléfono:</strong> ' || new.telefono || '</p>' else '' end
    || case when coalesce(new.discapacidad,'') != '' then '<p><strong>Discapacidad:</strong> ' || new.discapacidad || '</p>' else '' end
    || case when coalesce(new.carta,'') != '' then '<hr><p><strong>Carta:</strong><br>' || new.carta || '</p>' else '' end
    || case when coalesce(new.cv_url,'') != '' then '<p><a href="' || new.cv_url || '">Descargar CV</a></p>' else '' end;

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_resend_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'from',    v_from_email,
      'to',      array['sergi.martin.2003@gmail.com'],
      'subject', v_subject,
      'html',    v_body
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_company on public.applications;
create trigger trg_notify_company
  after insert on public.applications
  for each row execute function public.notify_company_application();


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. STORAGE — bucket público para los CVs
-- ═══════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('cvs', 'cvs', true)
on conflict do nothing;

-- NOTA: si estas dos políticas fallan con "must be owner of table objects"
-- (pasa en proyectos nuevos de Supabase), créalas desde el Dashboard:
-- Storage → cvs → Policies → New policy:
--   1) INSERT para rol anon con expresión:  bucket_id = 'cvs'
--   2) SELECT para rol anon con expresión:  bucket_id = 'cvs'
drop policy if exists "Candidato puede subir CV" on storage.objects;
create policy "Candidato puede subir CV"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'cvs');

drop policy if exists "CV es de lectura pública" on storage.objects;
create policy "CV es de lectura pública"
  on storage.objects for select
  to anon
  using (bucket_id = 'cvs');
