-- IncluJob — Candidaturas + notificación de email
-- Ejecuta esto en SQL Editor de Supabase después de supabase-schema.sql

-- 1. Extensión pg_net (viene activa por defecto en Supabase)
create extension if not exists pg_net with schema extensions;

-- 2. Tabla de candidaturas
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

-- 3. Row Level Security
alter table public.applications enable row level security;

create policy "Candidato puede enviar candidatura"
  on public.applications for insert
  to anon
  with check (true);

create policy "Admin puede ver candidaturas"
  on public.applications for select
  to authenticated
  using (true);

-- 4. Bucket para CVs (público — URL es única y no adivinable)
insert into storage.buckets (id, name, public)
values ('cvs', 'cvs', true)
on conflict do nothing;

create policy "Candidato puede subir CV"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'cvs');

create policy "CV es de lectura pública"
  on storage.objects for select
  to anon
  using (bucket_id = 'cvs');

-- 5. Función auxiliar para escapar HTML (previene XSS en emails)
create or replace function private.html_escape(input text)
returns text
language sql
immutable strict
as $$
  select replace(replace(replace(replace(replace(
    coalesce(input, ''),
    '&', '&amp;'),
    '<', '&lt;'),
    '>', '&gt;'),
    '"', '&quot;'),
    '''', '&#39;')
$$;

-- 6. Función de notificación de email via Resend
-- IMPORTANTE: configura las claves en Supabase SQL Editor tras ejecutar este archivo:
--   alter database postgres set app.resend_api_key = 'tu_clave_resend';
--   alter database postgres set app.admin_email    = 'tu@email.com';
-- NO escribas las claves directamente en este archivo.

create or replace function public.notify_company_application()
returns trigger
language plpgsql
security definer
as $$
declare
  v_resend_key  text := current_setting('app.resend_api_key', true);
  v_admin_email text := current_setting('app.admin_email',    true);
  v_from_email  text := 'IncluJob <onboarding@resend.dev>';
  v_email_body  text;
  v_subject     text;
begin
  if v_resend_key is null or v_resend_key = '' then
    raise warning 'notify_company_application: app.resend_api_key no configurada, email no enviado';
    return new;
  end if;

  if v_admin_email is null or v_admin_email = '' then
    raise warning 'notify_company_application: app.admin_email no configurada, email no enviado';
    return new;
  end if;

  v_subject := 'Nueva candidatura para "' || coalesce(nullif(new.job_title,''), 'puesto sin especificar') || '" — IncluJob';

  v_email_body := '
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><style>
  body{font-family:Arial,sans-serif;background:#f5f7fa;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
  .header{background:#1a3a6b;padding:28px 32px;color:#fff}
  .header h1{margin:0;font-size:20px;font-weight:700}
  .header p{margin:4px 0 0;opacity:.8;font-size:14px}
  .body{padding:28px 32px}
  .body h2{margin:0 0 20px;font-size:17px;color:#1a3a6b}
  .field{margin-bottom:14px}
  .field label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:4px}
  .field p{margin:0;color:#111;font-size:15px}
  .divider{border:none;border-top:1px solid #e5e7eb;margin:20px 0}
  .carta{background:#f9fafb;border-left:3px solid #2ecc71;padding:14px 16px;border-radius:0 8px 8px 0;color:#374151;font-size:14px;line-height:1.6;white-space:pre-wrap}
  .cv-btn{display:inline-block;margin-top:8px;padding:10px 20px;background:#2ecc71;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px}
  .footer{background:#f9fafb;padding:16px 32px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <h1>Nueva candidatura recibida</h1>
    <p>Puesto: <strong>' || private.html_escape(new.job_title) || '</strong></p>
  </div>
  <div class="body">
    <h2>Datos del candidato</h2>
    <div class="field"><label>Nombre</label><p>' || private.html_escape(new.nombre) || '</p></div>
    <div class="field"><label>Email</label><p><a href="mailto:' || private.html_escape(new.email) || '">' || private.html_escape(new.email) || '</a></p></div>'
    || case when coalesce(new.telefono, '') != ''
       then '<div class="field"><label>Teléfono</label><p>' || private.html_escape(new.telefono) || '</p></div>' else '' end
    || case when coalesce(new.discapacidad, '') != ''
       then '<div class="field"><label>Tipo de discapacidad</label><p>' || private.html_escape(new.discapacidad) || '</p></div>' else '' end
    || case when coalesce(new.carta, '') != ''
       then '<hr class="divider"><div class="field"><label>Carta de presentación</label><div class="carta">' || private.html_escape(new.carta) || '</div></div>' else '' end
    || case when coalesce(new.cv_url, '') != ''
       then '<hr class="divider"><div class="field"><label>Currículum</label><a class="cv-btn" href="' || private.html_escape(new.cv_url) || '" target="_blank">Descargar CV</a></div>' else '' end
    || '
  </div>
  <div class="footer">Este mensaje ha sido enviado automáticamente por IncluJob · <a href="https://inclujob.es">inclujob.es</a></div>
</div>
</body></html>';

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_resend_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'from',    v_from_email,
      'to',      array[v_admin_email],
      'subject', v_subject,
      'html',    v_email_body
    )
  );

  return new;
end;
$$;

-- 6. Trigger
drop trigger if exists trg_notify_company on public.applications;
create trigger trg_notify_company
  after insert on public.applications
  for each row
  execute function public.notify_company_application();

-- 7. Índice útil para el panel admin
create index if not exists applications_job_id_idx on public.applications (job_id);
create index if not exists applications_created_at_idx on public.applications (created_at desc);
