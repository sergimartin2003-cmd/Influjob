-- IncluJob — Supabase schema
-- Ejecuta esto en el SQL Editor de tu dashboard de Supabase
-- https://supabase.com/dashboard → SQL Editor → New query

-- 1. Tabla principal de ofertas
create table if not exists public.jobs (
  id                  bigserial primary key,
  created_at          timestamptz default now(),

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
  requisitos          text,          -- una línea por requisito, separadas por \n
  beneficios          text,          -- una línea por beneficio

  -- Inclusión
  certificado_minimo  text,          -- 33% | 45% | 65% | Sin mínimo
  discapacidad_tipos  text,          -- "física, auditiva, visual, ..."
  ajustes_razonables  text,          -- sí | no | en evaluación

  -- Workflow
  estado              text default 'pendiente'  -- pendiente | publicada | rechazada
);

-- 2. Función de auto-aprobación
-- Publica la oferta automáticamente si los campos mínimos son válidos.
-- Requisitos: empresa, puesto y email de contacto rellenos y email con formato correcto.
create or replace function public.auto_approve_job()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Validar campos obligatorios
  if (
    trim(new.empresa)          != '' and
    trim(new.puesto)           != '' and
    trim(new.email_contacto)   != '' and
    new.email_contacto ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ) then
    new.estado := 'publicada';
  else
    new.estado := 'pendiente';  -- queda para revisión manual
  end if;

  return new;
end;
$$;

-- 3. Trigger que dispara la función antes de cada INSERT
drop trigger if exists trg_auto_approve_job on public.jobs;
create trigger trg_auto_approve_job
  before insert on public.jobs
  for each row
  execute function public.auto_approve_job();

-- 4. Row Level Security
alter table public.jobs enable row level security;

-- Visitante puede enviar una oferta (siempre llega como 'pendiente';
-- el trigger la sube a 'publicada' si es válida)
create policy "Cualquiera puede enviar oferta"
  on public.jobs for insert
  to anon
  with check (estado = 'pendiente');

-- Solo se leen las publicadas
create policy "Solo ofertas publicadas son visibles"
  on public.jobs for select
  to anon
  using (estado = 'publicada');

-- El admin autenticado puede hacer cualquier cosa
create policy "Admin puede actualizar estado"
  on public.jobs for update
  to authenticated
  using (true)
  with check (true);

create policy "Admin puede leer todas"
  on public.jobs for select
  to authenticated
  using (true);

-- 5. Índices
create index if not exists jobs_estado_idx      on public.jobs (estado);
create index if not exists jobs_created_at_idx  on public.jobs (created_at desc);
