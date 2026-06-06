-- Corrección del trigger de email — ejecuta esto en SQL Editor de Supabase
-- IMPORTANTE: añade RESEND_API_KEY en Supabase Dashboard → Settings → Vault
--             y ADMIN_EMAIL del mismo modo, o edita los valores abajo.

-- Función auxiliar para escapar HTML y prevenir XSS en emails
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

create or replace function public.notify_company_application()
returns trigger
language plpgsql
security definer
as $$
declare
  v_resend_key  text := current_setting('app.resend_api_key', true);
  v_from_email  text := 'IncluJob <onboarding@resend.dev>';
  v_to_email    text;
  v_subject     text;
  v_body        text;
begin
  if v_resend_key is null or v_resend_key = '' then
    raise warning 'notify_company_application: app.resend_api_key no configurada, email no enviado';
    return new;
  end if;

  v_to_email := coalesce(nullif(trim(new.company_email), ''), null);
  if v_to_email is null then
    raise warning 'notify_company_application: sin company_email, email no enviado (job_id=%)', new.job_id;
    return new;
  end if;

  v_subject := 'Nueva candidatura — ' || coalesce(nullif(new.job_title,''), 'IncluJob');

  v_body := '<h2 style="color:#1a3a6b">Nueva candidatura recibida</h2>'
    || '<p><strong>Puesto:</strong> ' || private.html_escape(new.job_title) || '</p>'
    || '<p><strong>Nombre:</strong> ' || private.html_escape(new.nombre) || '</p>'
    || '<p><strong>Email:</strong> <a href="mailto:' || private.html_escape(new.email) || '">' || private.html_escape(new.email) || '</a></p>'
    || case when coalesce(new.telefono, '') != '' then '<p><strong>Teléfono:</strong> ' || private.html_escape(new.telefono) || '</p>' else '' end
    || case when coalesce(new.discapacidad, '') != '' then '<p><strong>Discapacidad:</strong> ' || private.html_escape(new.discapacidad) || '</p>' else '' end
    || case when coalesce(new.carta, '') != '' then '<hr><p><strong>Carta:</strong><br>' || private.html_escape(new.carta) || '</p>' else '' end;

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_resend_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'from',    v_from_email,
      'to',      array[v_to_email],
      'subject', v_subject,
      'html',    v_body
    )
  );

  -- Borra datos personales antes de persistir
  new.nombre       := null;
  new.email        := null;
  new.telefono     := null;
  new.discapacidad := null;
  new.carta        := null;
  new.cv_url       := null;

  return new;
end;
$$;

-- Después de ejecutar este archivo, configura en Supabase SQL Editor:
--   alter database postgres set app.resend_api_key = 'tu_clave_resend';
