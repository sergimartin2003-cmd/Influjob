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
  descripcion text,
  nif         text,                       -- CIF / NIF de la empresa
  nif_valido  boolean not null default false  -- lo fija el servidor (checksum oficial)
);

-- Por si la tabla ya existía de una ejecución anterior
alter table public.companies add column if not exists nif        text;
alter table public.companies add column if not exists nif_valido boolean not null default false;

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

-- VERIFICACIÓN FISCAL: valida el dígito de control oficial de un documento
-- español (CIF de empresa, NIF/DNI de autónomo o NIE). Devuelve true solo si
-- el checksum es correcto. Es determinista, así que se ejecuta en el servidor
-- y el cliente NO puede falsear el resultado.
create or replace function public.es_nif_valido(doc text)
returns boolean
language plpgsql
immutable
as $$
declare
  v     text := upper(regexp_replace(coalesce(doc, ''), '[\s\-\.]', '', 'g'));
  letras text := 'TRWAGMYFPDXBNJZSQVHLCKE';
  org   text;
  digs  text;
  ctrl  text;
  s     int := 0;
  n     int;
  i     int;
  e     int;
  letra_ctrl text;
begin
  -- DNI / NIF autónomo: 8 dígitos + letra de control
  if v ~ '^[0-9]{8}[A-Z]$' then
    return substr(letras, ((substr(v, 1, 8))::int % 23) + 1, 1) = substr(v, 9, 1);
  end if;

  -- NIE: X/Y/Z + 7 dígitos + letra
  if v ~ '^[XYZ][0-9]{7}[A-Z]$' then
    return substr(letras,
      ((translate(substr(v, 1, 1), 'XYZ', '012') || substr(v, 2, 7))::int % 23) + 1, 1)
      = substr(v, 9, 1);
  end if;

  -- CIF de empresa: letra + 7 dígitos + control (dígito o letra)
  if v ~ '^[ABCDEFGHJKLMNPQRSUVW][0-9]{7}[0-9A-J]$' then
    org  := substr(v, 1, 1);
    digs := substr(v, 2, 7);
    ctrl := substr(v, 9, 1);
    for i in 1..7 loop
      n := substr(digs, i, 1)::int;
      if i % 2 = 1 then          -- posiciones impares se multiplican por 2
        n := n * 2;
        if n > 9 then n := (n / 10) + (n % 10); end if;
      end if;
      s := s + n;
    end loop;
    e := (10 - (s % 10)) % 10;
    letra_ctrl := substr('JABCDEFGHI', e + 1, 1);
    if position(org in 'PQRSNW') > 0 then
      return ctrl = letra_ctrl;              -- estas formas usan letra
    elsif position(org in 'ABEH') > 0 then
      return ctrl = e::text;                 -- estas usan dígito
    else
      return ctrl = e::text or ctrl = letra_ctrl;  -- el resto acepta cualquiera
    end if;
  end if;

  return false;
end;
$$;

-- Recalcula nif_valido en el servidor cada vez que se guarda la empresa,
-- ignorando cualquier valor que mande el cliente (no se puede falsear).
create or replace function public.set_nif_valido()
returns trigger
language plpgsql
as $$
begin
  new.nif_valido := public.es_nif_valido(new.nif);
  return new;
end;
$$;

drop trigger if exists trg_set_nif_valido on public.companies;
create trigger trg_set_nif_valido
  before insert or update on public.companies
  for each row execute function public.set_nif_valido();

-- Al registrarse un usuario, se crea automáticamente su ficha de empresa
-- con los datos que rellenó en el formulario de registro (metadata del signup)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.companies (id, nombre, email, telefono, web, sector, nif)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'empresa', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'telefono', ''),
    coalesce(new.raw_user_meta_data->>'web', ''),
    coalesce(new.raw_user_meta_data->>'sector', ''),
    coalesce(new.raw_user_meta_data->>'nif', '')
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

-- Empresa registrada publica ofertas ligadas a su cuenta.
-- Solo si su CIF/NIF ha superado la verificación fiscal (nif_valido = true).
drop policy if exists "Empresa publica sus ofertas" on public.jobs;
create policy "Empresa publica sus ofertas"
  on public.jobs for insert
  to authenticated
  with check (
    fuente is null
    and company_id = auth.uid()
    and exists (
      select 1 from public.companies c
      where c.id = auth.uid() and c.nif_valido
    )
  );

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
