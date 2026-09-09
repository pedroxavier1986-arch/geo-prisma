import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
const endpoint = 'https://zcmwhnpybnwirlwkoqbx.supabase.co/functions/v1/geo-prisma';
const session = randomBytes(32).toString('hex');
async function call(action, body = {}, key=session) {
 const r = await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-session-key':key},body:JSON.stringify({action,...body})});
 const data=await r.json(); return {status:r.status,data};
}
assert.equal((await call('history',{},'bad')).status,401);
assert.equal((await call('worker')).status,401);
const w=new ExcelJS.Workbook(); w.addWorksheet('Base').addRows([['name','cep','city','latitude','longitude'],['Exemplo técnico','01311100','São Paulo',null,null]]);
const bytes=await w.xlsx.writeBuffer();
const {status,data:prepared}=await call('prepare',{filename:'teste-integracao.xlsx',bytes:bytes.length});
assert.equal(status,200,JSON.stringify(prepared));
const upload=await fetch(prepared.uploadUrl,{method:'PUT',headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:bytes});
assert.equal(upload.ok,true,await upload.text());
assert.equal((await call('status',{id:prepared.id},randomBytes(32).toString('hex'))).status,404);
const start=await call('start',{id:prepared.id,places:[{cep:'01311100',city:'São Paulo'}]});
assert.equal(start.status,200,JSON.stringify(start.data));
console.log('Upload, validação de sessão e início da fila: OK. Job:',prepared.id);
for(let i=0;i<48;i++) {
 await new Promise(r=>setTimeout(r,5000));
 const result=await call('status',{id:prepared.id}); assert.equal(result.status,200,JSON.stringify(result.data));
 if(i%4===0) console.log('Fila:',result.data.job.status,result.data.job.completed+'/'+result.data.job.total);
 if(result.data.job.status==='completed') {
  assert.equal(result.data.results.length,1);
  const original=await call('original',{id:prepared.id}); assert.equal(original.status,200);
  const fetched=await fetch(original.data.url); assert.equal(fetched.ok,true);
  const returned=new ExcelJS.Workbook(); await returned.xlsx.load(await fetched.arrayBuffer());
  assert.equal(returned.getWorksheet('Base').getCell('A2').value,'Exemplo técnico');
  console.log('Fila persistente, processamento e download privado: OK.',JSON.stringify(result.data.results));
  process.exit(0);
 }
}
throw new Error('Worker não concluiu no tempo esperado. Verificar cron e logs.');
