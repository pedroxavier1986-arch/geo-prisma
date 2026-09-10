-- Geo Prisma. Browser access goes through the capability-authenticated Edge Function.
-- No public Data API or Storage access to user files or job data.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.gp_jobs (
 id uuid primary key default gen_random_uuid(), session_hash text not null,
 filename text not null check(length(filename) <= 180), path text not null,
 bytes integer not null check(bytes between 1 and 5242880),
 status text not null default 'uploading' check(status in ('uploading','queued','running','completed','failed')),
 total integer not null default 0, completed integer not null default 0,
 succeeded integer not null default 0, failed integer not null default 0,
 message text, created_at timestamptz not null default now()
);
create index gp_jobs_session_created on public.gp_jobs(session_hash, created_at desc);
create table public.gp_tasks (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.gp_jobs on delete cascade,
 key text not null, cep text not null check(cep ~ '^\d{8}$'), city text not null,
 status text not null default 'pending' check(status in ('pending','working','success','not_found','failed')),
 latitude double precision, longitude double precision, provider text, reason text,
 attempts integer not null default 0, next_at timestamptz not null default now(),
 unique(job_id,key)
);
create index gp_tasks_pending on public.gp_tasks(status,next_at);
alter table public.gp_tasks add column if not exists address text;
create table public.gp_cache (
 key text primary key, latitude double precision not null, longitude double precision not null,
 provider text not null, created_at timestamptz not null default now()
);
create table public.gp_worker (
 singleton boolean primary key default true check(singleton), secret_hash text not null,
 lease_owner uuid, lease_until timestamptz not null default now()
);
alter table public.gp_jobs enable row level security;
alter table public.gp_tasks enable row level security;
alter table public.gp_cache enable row level security;
alter table public.gp_worker enable row level security;
revoke all on public.gp_jobs, public.gp_tasks, public.gp_cache, public.gp_worker from public, anon, authenticated;
grant all on public.gp_jobs, public.gp_tasks, public.gp_cache, public.gp_worker to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('geo-prisma','geo-prisma',false,5242880,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

-- All RPCs use invoker rights and are executable only by the service role.
create function public.gp_prepare(p_session text,p_filename text,p_bytes integer)
returns public.gp_jobs language plpgsql set search_path = '' as $$
declare j public.gp_jobs; identifier uuid := gen_random_uuid();
begin
 perform pg_advisory_xact_lock(7138421);
 if (select count(*) from public.gp_jobs where session_hash=p_session and created_at>now()-interval '1 hour')>=5
 or (select count(*) from public.gp_jobs where created_at>now()-interval '1 day')>=100 then
  raise exception 'Limite de envios atingido. Tente mais tarde.';
 end if;
 insert into public.gp_jobs(id,session_hash,filename,path,bytes)
 values(identifier,p_session,p_filename,identifier::text||'/original.xlsx',p_bytes) returning * into j;
 return j;
end $$;

create function public.gp_start(p_id uuid,p_session text,p_places jsonb)
returns void language plpgsql set search_path = '' as $$
declare j public.gp_jobs;
begin
 select * into j from public.gp_jobs where id=p_id and session_hash=p_session for update;
 if not found then raise exception 'Arquivo não encontrado.'; end if;
 if j.status<>'uploading' then return; end if;
 if jsonb_array_length(p_places) not between 1 and 3000 then raise exception 'Quantidade de localidades inválida.'; end if;
 insert into public.gp_tasks(job_id,key,cep,city,address)
 select p_id,v->>'key',v->>'cep',v->>'city',v->>'address' from jsonb_array_elements(p_places) v on conflict do nothing;
 update public.gp_jobs set status='queued',total=(select count(*) from public.gp_tasks where job_id=p_id) where id=p_id;
end $$;

create function public.gp_claim_worker(p_owner uuid)
returns boolean language plpgsql set search_path = '' as $$
begin
 update public.gp_worker set lease_owner=p_owner,lease_until=now()+interval '110 seconds'
 where singleton=true and lease_until<now();
 return found;
end $$;

create function public.gp_next_task()
returns setof public.gp_tasks language plpgsql set search_path = '' as $$
declare task_id uuid;
begin
 select t.id into task_id from public.gp_tasks t join public.gp_jobs j on j.id=t.job_id
 where j.status in ('queued','running') and t.status in ('pending','working') and t.next_at<=now()
 order by t.next_at,t.id for update of t skip locked limit 1;
 if task_id is null then return; end if;
 update public.gp_jobs set status='running' where id=(select job_id from public.gp_tasks where id=task_id);
 return query update public.gp_tasks set status='working',attempts=attempts+1,next_at=now()+interval '2 minutes' where id=task_id returning *;
end $$;

create function public.gp_refresh_jobs()
returns void language sql set search_path = '' as $$
 update public.gp_jobs j set completed=s.done,succeeded=s.ok,failed=s.bad,
 status=case when s.done=j.total then 'completed' else j.status end
 from (select job_id,count(*) filter(where status in ('success','not_found','failed'))::integer done,
 count(*) filter(where status='success')::integer ok,
 count(*) filter(where status in ('not_found','failed'))::integer bad from public.gp_tasks group by job_id) s
 where j.id=s.job_id and j.status in ('queued','running');
$$;
revoke all on function public.gp_prepare(text,text,integer),public.gp_start(uuid,text,jsonb),public.gp_claim_worker(uuid),public.gp_next_task(),public.gp_refresh_jobs() from public,anon,authenticated;
grant execute on function public.gp_prepare(text,text,integer),public.gp_start(uuid,text,jsonb),public.gp_claim_worker(uuid),public.gp_next_task(),public.gp_refresh_jobs() to service_role;

-- Generate the scheduler credential inside the database, never in client code.
do $$
declare worker_secret text := encode(extensions.gen_random_bytes(32),'hex');
begin
 perform vault.create_secret(worker_secret,'geo_prisma_worker','Geo Prisma scheduler credential');
 insert into public.gp_worker(singleton,secret_hash) values(true,encode(extensions.digest(worker_secret,'sha256'),'hex'));
end $$;
