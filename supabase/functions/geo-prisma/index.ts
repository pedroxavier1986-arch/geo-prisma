import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-session-key,x-worker-key', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Cache-Control': 'no-store' };
const send = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
const norm = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
const publicJob = (j: Record<string, unknown>) => ({ id:j.id,filename:j.filename,status:j.status,total:j.total,completed:j.completed,succeeded:j.succeeded,failed:j.failed,created_at:j.created_at,message:j.message });
const must = <T>(result: { data: T; error: unknown }): T => { if (result.error) throw result.error; return result.data; };

async function worker() {
 const owner = crypto.randomUUID();
 const claimed = must(await db.rpc('gp_claim_worker', { p_owner: owner }));
 if (!claimed) return;
 const start = Date.now();
 try {
  for (let i = 0; i < 20 && Date.now() - start < 48000; i++) {
   const tasks = must(await db.rpc('gp_next_task'));
   const task = tasks?.[0]; if (!task) break;
   try {
    const cached = must(await db.from('gp_cache').select('latitude,longitude,provider').eq('key', task.key).gt('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).maybeSingle());
    let match = cached;
    if (!match) {
     const url = new URL(Deno.env.get('PHOTON_URL') || 'https://photon.komoot.io/api/');
     url.searchParams.set('q', `${task.address}, ${task.cep.slice(0,5)}-${task.cep.slice(5)}, ${task.city}, Brazil`);
     url.searchParams.set('limit', '5'); url.searchParams.set('lang','en');
     const response = await fetch(url, { headers: { 'User-Agent': 'GeoPrisma-Analitx/1.0' }, signal: AbortSignal.timeout(8000) });
     if (!response.ok) throw new Error(`Serviço temporariamente indisponível (${response.status})`);
     const data = await response.json();
     const feature = data.features?.find((f: { properties?: Record<string,string>; geometry?: { coordinates?: number[] } }) => {
      const p = f.properties || {}, c = f.geometry?.coordinates;
      const postcode = (p.postcode || p.name || '').replace(/\D/g,'');
      const addressTokens = norm(task.address).split(/[^a-z0-9]+/).filter(v => v.length > 2);
      const resultText = norm([p.name,p.street,p.locality,p.district].filter(Boolean).join(' '));
      const addressMatch = addressTokens.length === 0 || addressTokens.filter(token => resultText.includes(token)).length >= Math.min(2, addressTokens.length);
      return p.countrycode?.toUpperCase() === 'BR' &&
       [p.city,p.town,p.village,p.county].filter(Boolean).some(v => norm(v) === norm(task.city)) &&
       addressMatch && (postcode === task.cep || p.osm_value === 'postcode' || !p.postcode) &&
       Array.isArray(c) && c.length>=2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0])<=180 && Math.abs(c[1])<=90;
     });
     if (feature) match = { latitude: feature.geometry.coordinates[1], longitude: feature.geometry.coordinates[0], provider: 'Photon / OpenStreetMap' };
     // One global worker, deliberate pacing, and persistent cache.
     await new Promise(resolve => setTimeout(resolve, 1200));
    }
    if (match) {
     must(await db.from('gp_cache').upsert({ key: task.key, ...match, created_at: new Date().toISOString() }));
     must(await db.from('gp_tasks').update({ status:'success', ...match, reason:null }).eq('id',task.id));
    } else must(await db.from('gp_tasks').update({ status:'not_found',reason:'Nenhum resultado confirmou o CEP e a cidade no Brasil.' }).eq('id',task.id));
   } catch {
    must(await db.from('gp_tasks').update({ status:task.attempts>=3?'failed':'pending',reason:task.attempts>=3?'Serviço indisponível após três tentativas. Envie novamente mais tarde.':null,next_at:new Date(Date.now()+60000*task.attempts).toISOString() }).eq('id',task.id));
   }
   must(await db.rpc('gp_refresh_jobs'));
  }
 } finally {
  await db.rpc('gp_refresh_jobs');
  await db.from('gp_worker').update({ lease_until: new Date(0).toISOString(), lease_owner:null }).eq('singleton',true).eq('lease_owner',owner);
 }
}

Deno.serve(async req => {
 if (req.method === 'OPTIONS') return new Response(null, { headers:cors });
 if (req.method !== 'POST') return send({error:'Método não permitido.'},405);
 try {
  const raw = await req.text(); if (raw.length > 1500000) return send({error:'Requisição muito grande.'},413);
  const body = JSON.parse(raw);
  if (body.action === 'worker') {
   const key = req.headers.get('x-worker-key') || '';
   if (!/^[a-f0-9]{64}$/.test(key)) return send({error:'Não autorizado.'},401);
   const cfg = must(await db.from('gp_worker').select('secret_hash').eq('singleton',true).single());
   if (await hash(key) !== cfg.secret_hash) return send({error:'Não autorizado.'},401);
   EdgeRuntime.waitUntil(worker().catch(error => console.error('Worker failed', error)));
   return send({accepted:true});
  }
  const token = req.headers.get('x-session-key') || '';
  if (!/^[a-f0-9]{64}$/.test(token)) return send({error:'Sessão inválida. Reabra a página.'},401);
  const session = await hash(token);
  if (body.action === 'prepare') {
   if (typeof body.filename!=='string' || !/\.xlsx$/i.test(body.filename) || body.filename.length>180 || !Number.isInteger(body.bytes) || body.bytes<1 || body.bytes>5242880) return send({error:'Arquivo inválido. Use um .xlsx de até 5 MB.'},400);
   const prepared = await db.rpc('gp_prepare',{p_session:session,p_filename:body.filename,p_bytes:body.bytes});
   if (prepared.error) return send({error:prepared.error.message.includes('Limite')?'Limite de envios atingido. Tente mais tarde.':'Não foi possível preparar o envio.'},429);
   const job = prepared.data;
   const upload = must(await db.storage.from('geo-prisma').createSignedUploadUrl(job.path));
   return send({id:job.id,uploadUrl:upload.signedUrl});
  }
  if (body.action === 'history') {
   const jobs = must(await db.from('gp_jobs').select('*').eq('session_hash',session).neq('status','uploading').order('created_at',{ascending:false}).limit(30));
   return send({jobs:jobs.map(publicJob)});
  }
  if (typeof body.id!=='string' || !/^[a-f0-9-]{36}$/.test(body.id)) return send({error:'Identificador inválido.'},400);
  const job = must(await db.from('gp_jobs').select('*').eq('id',body.id).eq('session_hash',session).maybeSingle());
  if (!job) return send({error:'Arquivo não encontrado nesta sessão.'},404);
  if (body.action === 'start') {
   if (!Array.isArray(body.places) || !body.places.length || body.places.length>3000) return send({error:'Use entre 1 e 3.000 localidades.'},400);
   const places = body.places.map((p: Record<string,unknown>) => {
    if (!p || typeof p.cep!=='string' || !/^\d{8}$/.test(p.cep) || typeof p.city!=='string' || !p.city.trim() || p.city.length>120 || typeof p.address!=='string' || !p.address.trim() || p.address.length>240) throw new Error('invalid_places');
    const city = p.city.trim().replace(/\s+/g,' '), address = p.address.trim().replace(/\s+/g,' '); return {cep:p.cep,city,address,key:`${p.cep}|${norm(city)}|${norm(address)}`};
   });
   const exists = must(await db.storage.from('geo-prisma').exists(job.path));
   if (!exists) return send({error:'O upload ainda não foi concluído.'},409);
   must(await db.rpc('gp_start',{p_id:job.id,p_session:session,p_places:places}));
   // Progress does not depend on this request: cron resumes the durable queue.
   return send({id:job.id});
  }
  if (body.action === 'status') {
   const results: unknown[] = [];
   for(let offset=0; offset<job.total; offset+=500) {
    const page = must(await db.from('gp_tasks').select('key,latitude,longitude,status,provider,reason').eq('job_id',job.id).in('status',['success','not_found','failed']).order('id').range(offset,offset+499));
    results.push(...page); if(page.length<500) break;
   }
   return send({job:publicJob(job),results});
  }
  if (body.action === 'original') {
   const link = must(await db.storage.from('geo-prisma').createSignedUrl(job.path,120));
   return send({url:link.signedUrl});
  }
  return send({error:'Ação desconhecida.'},400);
 } catch (error) {
  if(error instanceof SyntaxError || (error instanceof Error && error.message==='invalid_places')) return send({error:'Dados inválidos. Confira sua planilha.'},400);
  console.error('Geo Prisma request failed',error);
  return send({error:'Não foi possível concluir esta ação. Tente novamente.'},500);
 }
});
