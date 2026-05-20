-- IncluJob — Migración para el bot de scraping
-- Ejecuta esto en SQL Editor de Supabase (New query)

-- 1. Nuevas columnas en la tabla jobs para rastrear el origen
alter table public.jobs
  add column if not exists fuente      text,
  add column if not exists external_id text unique,
  add column if not exists source_url  text;

-- 2. Actualizar el trigger de auto-aprobación para soportar dos modos:
--    a) Oferta de formulario (fuente IS NULL): valida empresa + puesto + email
--    b) Oferta del bot (fuente IS NOT NULL): confía en el estado que decidió el scraper

create or replace function public.auto_approve_job()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.fuente is not null then
    -- Oferta del bot: el scraper ya decidió el estado según palabras clave
    -- No se toca — se publica o queda pendiente según lo que dijo el bot
    return new;
  else
    -- Oferta de formulario: auto-publicar si los campos obligatorios son válidos
    if (
      trim(coalesce(new.empresa, ''))         != '' and
      trim(coalesce(new.puesto, ''))          != '' and
      trim(coalesce(new.email_contacto, ''))  != '' and
      new.email_contacto ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    ) then
      new.estado := 'publicada';
    else
      new.estado := 'pendiente';
    end if;
    return new;
  end if;
end;
$$;

-- 3. Índices para las nuevas columnas
create index if not exists jobs_fuente_idx      on public.jobs (fuente);
create index if not exists jobs_external_id_idx on public.jobs (external_id);
