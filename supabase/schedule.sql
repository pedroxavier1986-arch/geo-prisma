-- Run after deploying the Edge Function. Replace the project hostname when recreating elsewhere.
select cron.schedule('geo-prisma-worker','* * * * *',$$
 select net.http_post(
  url := 'https://zcmwhnpybnwirlwkoqbx.supabase.co/functions/v1/geo-prisma',
  headers := jsonb_build_object('Content-Type','application/json','x-worker-key',
   (select decrypted_secret from vault.decrypted_secrets where name='geo_prisma_worker')),
  body := '{"action":"worker"}'::jsonb, timeout_milliseconds := 10000
 ) where exists(select 1 from public.gp_jobs where status in ('queued','running'));
$$);
