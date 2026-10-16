-- Structural guarantees every future migration must keep.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

select is(
  (select array_agg(tablename::text order by tablename) from pg_tables
    where schemaname = 'public' and not rowsecurity),
  null,
  'every table in public has row level security enabled'
);

select is(
  (select array_agg(distinct table_name::text) from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'),
  null,
  'anon holds no privileges on any public table or view'
);

select is(
  (select array_agg(c.relname::text order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce('security_invoker=true' = any (c.reloptions), false)),
  null,
  'every view in public is security_invoker (RLS of base tables applies)'
);

select is(
  (select array_agg(t.table_name::text order by t.table_name)
     from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and t.table_name not in ('profiles', 'organizations')
      and not exists (select 1 from information_schema.columns c
                       where c.table_schema = 'public' and c.table_name = t.table_name
                         and c.column_name = 'organization_id' and c.is_nullable = 'NO')),
  null,
  'every business table carries a NOT NULL organization_id'
);

select is(
  (select array_agg(distinct table_name::text || ':' || privilege_type) from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public'
      and privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  null,
  'authenticated holds only DML privileges (no TRUNCATE, which bypasses RLS)'
);

select ok(
  not has_function_privilege('anon', 'public.create_organization(text, text, text, text, text)', 'execute'),
  'anon cannot call create_organization'
);

select * from finish();
rollback;
