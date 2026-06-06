-- IncluJob — Tabla de suscriptores a la newsletter
-- Ejecuta esto en SQL Editor de Supabase

create table if not exists public.newsletter_subscribers (
  id          bigserial primary key,
  created_at  timestamptz default now(),
  email       text not null unique,
  nombre      text,
  frecuencia  text default 'semanal' check (frecuencia in ('diaria', 'semanal', 'quincenal')),
  ciudades    text,
  sectores    text,
  activo      boolean default true
);

alter table public.newsletter_subscribers enable row level security;

create policy "Cualquiera puede suscribirse"
  on public.newsletter_subscribers for insert
  to anon
  with check (
    email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  );

create policy "Admin puede ver suscriptores"
  on public.newsletter_subscribers for select
  to authenticated
  using (true);

create index if not exists newsletter_email_idx on public.newsletter_subscribers (email);
create index if not exists newsletter_created_at_idx on public.newsletter_subscribers (created_at desc);
