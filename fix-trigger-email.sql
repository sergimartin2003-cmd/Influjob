-- Corrección del trigger de email — ejecuta esto en SQL Editor de Supabase

create or replace function public.notify_company_application()
returns trigger
language plpgsql
security definer
as $$
declare
  v_resend_key  text := 're_Bt1pSbcY_74fLgwpToQStfwz4tXyn3eJX';
  v_from_email  text := 'IncluJob <onboarding@resend.dev>';
  v_subject     text;
  v_body        text;
begin
  v_subject := 'Nueva candidatura — ' || coalesce(nullif(new.job_title,''), 'IncluJob');

  v_body := '<h2 style="color:#1a3a6b">Nueva candidatura recibida</h2>'
    || '<p><strong>Puesto:</strong> ' || coalesce(new.job_title,'—') || '</p>'
    || '<p><strong>Nombre:</strong> ' || new.nombre || '</p>'
    || '<p><strong>Email:</strong> <a href="mailto:' || new.email || '">' || new.email || '</a></p>'
    || case when new.telefono != '' then '<p><strong>Teléfono:</strong> ' || new.telefono || '</p>' else '' end
    || case when new.discapacidad != '' then '<p><strong>Discapacidad:</strong> ' || new.discapacidad || '</p>' else '' end
    || case when new.carta != '' then '<hr><p><strong>Carta:</strong><br>' || new.carta || '</p>' else '' end
    || case when new.cv_url != '' then '<p><a href="' || new.cv_url || '">Descargar CV</a></p>' else '' end;

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
