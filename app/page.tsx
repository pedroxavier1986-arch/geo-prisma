'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CheckCheck, ChevronRight, CircleHelp, FileSpreadsheet, Layers3, LoaderCircle, MapPin, ShieldCheck, Upload, X, AlertCircle, RotateCcw, Clock3, LocateFixed } from 'lucide-react';
import type { Inspection, GeoResult } from '@/lib/workbook';
import { createJob, getJob, getHistory, getOriginal, isConfigured, type Job } from '@/lib/api';

function download(buffer: ArrayBuffer | Uint8Array, filename: string) {
 const blob = new Blob([new Uint8Array(buffer as ArrayBuffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
 const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const number = (value: number) => value.toLocaleString('pt-BR');

export default function Home() {
 const input = useRef<HTMLInputElement>(null);
 const dialog = useRef<HTMLDialogElement>(null);
 const [help, setHelp] = useState(false);
 const [tab, setTab] = useState<'new' | 'history'>('new');
 const [file, setFile] = useState<File | null>(null);
 const [inspection, setInspection] = useState<Inspection | null>(null);
 const [busy, setBusy] = useState(false);
 const [drag, setDrag] = useState(false);
 const [error, setError] = useState('');
 const [notice, setNotice] = useState('');
 const [job, setJob] = useState<Job | null>(null);
 const [results, setResults] = useState<GeoResult[]>([]);
 const [history, setHistory] = useState<Job[]>([]);
 const [historyLoading, setHistoryLoading] = useState(false);
 const [activeId, setActiveId] = useState<string | null>(null);
 const [exporting, setExporting] = useState(false);
 const running = Boolean(activeId && (!job || !['completed', 'failed'].includes(job.status)));
 const finished = job?.status === 'completed';
 const progress = job?.total ? Math.round(job.completed / job.total * 100) : 0;

 useEffect(() => { if (help) dialog.current?.showModal(); else dialog.current?.close(); }, [help]);
 useEffect(() => {
  if (!activeId) return;
  let stopped = false, timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
   try { const data = await getJob(activeId); if (stopped) return; setJob(data.job); setResults(data.results); setNotice('');
    if (!['completed', 'failed'].includes(data.job.status)) timer = setTimeout(poll, 4000);
   } catch (e) { if (!stopped) { setNotice(`${(e as Error).message} Tentaremos atualizar novamente.`); timer = setTimeout(poll, 8000); } }
  };
  void poll(); return () => { stopped = true; clearTimeout(timer); };
 }, [activeId]);

 async function loadFile(selected?: File) {
  if (!selected || running || busy) return;
  setError(''); setNotice(''); setJob(null); setActiveId(null); setResults([]); setInspection(null); setFile(null);
  if (!/\.xlsx$/i.test(selected.name)) { setError('Selecione um arquivo Excel no formato .xlsx.'); return; }
  if (selected.size > 5 * 1024 * 1024) { setError('O arquivo ultrapassa 5 MB. Divida a planilha em arquivos menores.'); return; }
  setBusy(true);
  try { const { inspectWorkbook } = await import('@/lib/workbook'); const data = await inspectWorkbook(await selected.arrayBuffer()); setInspection(data); setFile(selected); }
  catch (e) { setError((e as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
 }
 async function template() { try { const { templateWorkbook } = await import('@/lib/workbook'); download(await templateWorkbook(), 'Geo_Prisma_Modelo.xlsx'); } catch { setError('Não foi possível gerar o modelo. Tente novamente.'); } }
 async function start() {
  if (!file || !inspection) return;
  setError(''); setBusy(true);
  try {
   if (!inspection.places.length) { await saveResult(); return; }
   const id = await createJob(file, inspection.places); setActiveId(id);
  } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
 }
 async function saveResult() {
  if (!inspection || exporting) return; setExporting(true); setError('');
  try { const { exportWorkbook } = await import('@/lib/workbook'); download(await exportWorkbook(inspection, results), (file?.name || 'Geo_Prisma.xlsx').replace(/\.xlsx$/i, '_geocodificado.xlsx')); }
  catch { setError('Não foi possível gerar o arquivo. Tente baixar novamente.'); } finally { setExporting(false); }
 }
 async function openHistory() {
  setTab('history'); setError(''); setHistoryLoading(true);
  try { if (isConfigured()) setHistory((await getHistory()).jobs); } catch (e) { setError((e as Error).message); } finally { setHistoryLoading(false); }
 }
 async function resume(item: Job) {
  setBusy(true); setError('');
  try { const { url } = await getOriginal(item.id); const response = await fetch(url); if (!response.ok) throw new Error('O arquivo original não está disponível.'); const blob = await response.blob();
   const { inspectWorkbook } = await import('@/lib/workbook'); const loaded = await inspectWorkbook(await blob.arrayBuffer());
   setInspection(loaded); setFile(new File([blob], item.filename)); setResults([]); setJob(item); setActiveId(item.id); setTab('new');
  } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
 }
 function reset() { setFile(null); setInspection(null); setJob(null); setResults([]); setActiveId(null); setError(''); setNotice(''); }

 return <div className="app-shell">
  <header className="topbar"><div className="topbar-inner">
   <a className="product-brand" href="/" aria-label="Geo Prisma, início"><span className="product-icon"><MapPin size={21} strokeWidth={1.8}/></span><span>Geo Prisma</span></a>
   <div className="brand-signature"><span>por</span><span className="analitx-crop"><img src="/analitx-original.png" alt="ANALITX" width="174" height="174"/></span></div>
  </div></header>
  <main>
   <section className="intro"><div className="eyebrow">INTELIGÊNCIA GEOGRÁFICA</div><h1>Uma nova perspectiva<br/>para seus <span>endereços.</span></h1><p>Do Excel às coordenadas. Importe sua base e deixe o Geo Prisma<br className="desktop-break"/> encontrar a latitude e a longitude de cada localidade.</p></section>
   <div className="workspace-nav"><div className="tabs" role="tablist" aria-label="Área de trabalho"><button id="new-tab" role="tab" aria-selected={tab === 'new'} aria-controls="workspace" className={tab === 'new' ? 'selected' : ''} onClick={() => setTab('new')}><Layers3 size={16}/> Nova geocodificação</button><button id="history-tab" role="tab" aria-selected={tab === 'history'} aria-controls="workspace" className={tab === 'history' ? 'selected' : ''} onClick={openHistory}><Clock3 size={16}/> Meus arquivos</button></div><button className="text-button help-button" onClick={() => setHelp(true)}><CircleHelp size={16}/> Como funciona</button></div>
   <section id="workspace" role="tabpanel" aria-labelledby={tab === 'new' ? 'new-tab' : 'history-tab'} className="workspace">
    {tab === 'new' ? <>
     <div className="steps"><div className="step active"><span>{inspection ? <Check size={14}/> : '1'}</span>Importar planilha</div><div className="step-line"/><div className={`step ${running || finished ? 'active' : ''}`}><span>{finished ? <Check size={14}/> : '2'}</span>Geocodificar</div><div className="step-line"/><div className={`step ${finished ? 'active' : ''}`}><span>3</span>Baixar resultado</div></div>
     <div className="workspace-body"><div className="upload-panel">
      <div className="section-label">{finished ? 'SEU RESULTADO' : running ? 'PROCESSAMENTO' : 'SUA BASE DE ENDEREÇOS'}</div>
      <h2>{finished ? 'Coordenadas prontas.' : running ? 'Encontrando seu próximo ponto.' : 'Tudo começa com uma planilha.'}</h2>
      <p className="panel-description">{finished ? 'Baixe sua planilha preenchida e confira as pendências no relatório.' : running ? 'Você pode sair desta página e acompanhar depois em Meus arquivos.' : 'Envie seu arquivo Excel para identificar as localidades.'}</p>
      {!file ? <button className={`dropzone ${drag ? 'dragging' : ''}`} disabled={busy} onClick={() => input.current?.click()} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); void loadFile(e.dataTransfer.files[0]); }}>
       <span className="upload-icon">{busy ? <LoaderCircle className="spin" size={27}/> : <Upload size={27} strokeWidth={1.5}/>}</span><strong>{busy ? 'Lendo sua planilha…' : drag ? 'Solte o arquivo aqui' : 'Arraste sua planilha até aqui'}</strong><span>ou <b>escolha um arquivo</b> no computador</span><small>Excel .xlsx · Até 5 MB</small>
      </button> : <div className={`file-card ${finished ? 'file-finished' : ''}`}><span className="file-icon"><FileSpreadsheet size={27}/></span><div><strong title={file.name}>{file.name}</strong><span>{(file.size / 1024).toFixed(0)} KB · Aba Base</span></div>{!running && !busy && <button className="icon-button" onClick={reset} aria-label="Remover arquivo"><X size={18}/></button>}{finished && <span className="success-check"><CheckCheck size={20}/></span>}</div>}
      <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={e => void loadFile(e.target.files?.[0])}/>
      {inspection && !running && !finished && <div className="validation"><Check size={15}/><span>Estrutura validada · {number(inspection.total)} registros encontrados</span></div>}
      {running && <div className="progress-section" aria-live="polite"><div><span>{job?.status === 'queued' ? 'Na fila de processamento' : 'Consultando localidades'}</span><strong>{progress}%</strong></div><progress max={100} value={progress}/><p>{number(job?.completed || 0)} de {number(job?.total || inspection?.places.length || 0)} localidades verificadas</p></div>}
      {finished && <div className="result-summary"><div><strong>{number(job.succeeded)}</strong><span>localidades encontradas</span></div><div><strong>{number(job.failed)}</strong><span>para revisar</span></div></div>}
      {inspection && inspection.invalid > 0 && !running && <p className="warning"><AlertCircle size={16}/>{number(inspection.invalid)} registros com CEP ou cidade inválidos serão listados no relatório.</p>}
      {job?.status === 'failed' && <p className="warning"><AlertCircle size={16}/>{job.message || 'O processamento não foi concluído. Envie a planilha novamente para retomar usando o cache.'}</p>}
      <div className="upload-bottom">{!file && <><span>Precisa de um ponto de partida?</span><button className="text-button" onClick={template}><ArrowDownToLine size={15}/> Baixar modelo Excel</button></>}</div>
      <div className="primary-action"><button className="primary-button" disabled={!inspection || busy || running || exporting || job?.status === 'failed'} onClick={finished ? saveResult : start}>{busy || running || exporting ? <LoaderCircle className="spin" size={18}/> : finished ? <ArrowDownToLine size={18}/> : <LocateFixed size={18}/>}<span>{exporting ? 'Preparando download…' : busy ? 'Preparando…' : running ? 'Geocodificação em andamento' : finished ? 'Baixar planilha preenchida' : inspection && !inspection.places.length ? 'Baixar planilha e relatório' : 'Geocodificar endereços'}</span>{!running && !busy && !finished && <ArrowRight size={17}/>}</button>{finished && <button className="text-button" onClick={reset}><RotateCcw size={14}/> Começar outra geocodificação</button>}{!inspection && <small>Selecione uma planilha para continuar</small>}</div>
     </div>
     <aside className="details-panel"><div className="detail-heading"><span className="detail-icon"><FileSpreadsheet size={19}/></span><h3>{inspection ? 'Sua planilha, em números' : 'Prepare sua planilha'}</h3></div>
      {inspection ? <div className="stats-list"><div><span>Registros na base</span><strong>{number(inspection.total)}</strong></div><div><span>Já têm coordenadas</span><strong>{number(inspection.existing)}</strong></div><div><span>Precisam de coordenadas</span><strong>{number(inspection.pending)}</strong></div><div className="accent-stat"><span>Localidades únicas</span><strong>{number(inspection.places.length)}</strong></div></div> : <><p>Na aba <b>Base</b>, inclua estas colunas:</p><div className="column-list"><div><code>cep</code><span>CEP do endereço</span></div><div><code>city</code><span>Nome da cidade</span></div><div><code>latitude</code><span>Será preenchida</span></div><div><code>longitude</code><span>Será preenchida</span></div></div><p className="secondary-note">As demais colunas podem continuar<br/>na sua planilha.</p></>}
      <div className="precision-note"><MapPin size={20}/><div><strong>Um ponto por localidade</strong><p>Endereços com o mesmo CEP e cidade recebem as mesmas coordenadas.</p></div></div>
      <div className="preserve-note"><ShieldCheck size={16}/><span>Coordenadas já preenchidas são preservadas.</span></div>
     </aside></div>
    </> : <div className="history-panel"><div className="history-heading"><div><div className="section-label">SEU HISTÓRICO</div><h2>Meus arquivos</h2></div><button className="text-button" onClick={openHistory} disabled={historyLoading}><RotateCcw size={15}/> Atualizar</button></div><p className="panel-description">Arquivos enviados por este navegador. Guarde o resultado após o download.</p>{historyLoading ? <div className="empty-history"><LoaderCircle className="spin" size={26}/><p>Buscando seus arquivos…</p></div> : history.length ? <div className="history-list">{history.map(item => <button key={item.id} onClick={() => resume(item)} disabled={busy}><FileSpreadsheet size={23}/><span><strong>{item.filename}</strong><small>{new Date(item.created_at).toLocaleString('pt-BR')}</small></span><em>{item.status === 'completed' ? 'Concluído' : item.status === 'uploading' ? 'Upload incompleto' : item.status === 'failed' ? 'Falha' : `${item.completed}/${item.total}`}</em><ChevronRight size={18}/></button>)}</div> : <div className="empty-history"><Clock3 size={30} strokeWidth={1.4}/><h3>Seu primeiro arquivo começa aqui.</h3><p>As planilhas que você enviar aparecerão neste espaço.</p><button className="text-button" onClick={() => setTab('new')}>Importar uma planilha <ArrowRight size={16}/></button></div>}</div>}
   </section>
   {error && <div className="message error" role="alert"><AlertCircle size={18}/><span>{error}</span><button className="icon-button" aria-label="Fechar mensagem" onClick={() => setError('')}><X size={16}/></button></div>}
   {notice && <div className="message" role="status"><Clock3 size={18}/>{notice}</div>}
   {inspection && tab === 'new' && <section className="preview-section"><div className="preview-heading"><h3>Uma prévia da sua base</h3><span>Primeiros {Math.min(5, inspection.rows.length)} de {number(inspection.total)} registros</span></div><div className="table-scroll"><table><thead><tr><th>Estabelecimento</th><th>CEP</th><th>Cidade</th><th>Latitude</th><th>Longitude</th><th>Status</th></tr></thead><tbody>{inspection.rows.slice(0, 5).map(row => { const result = results.find(r => r.key === row.key); const existing = row.latitude !== null && row.longitude !== null; return <tr key={row.row}><td>{row.name}</td><td>{row.cep}</td><td>{row.city}</td><td>{(existing ? row.latitude : result?.latitude)?.toFixed(6) || '—'}</td><td>{(existing ? row.longitude : result?.longitude)?.toFixed(6) || '—'}</td><td><span className={`row-status ${existing || result?.status === 'success' ? 'ok' : ''}`}>{existing ? 'Preservado' : row.issue ? 'Revisar' : result?.status === 'success' ? 'Preenchido' : finished ? 'Não encontrado' : 'Pendente'}</span></td></tr>; })}</tbody></table></div></section>}
   <div className="under-note"><ShieldCheck size={16}/><span>Seu arquivo original permanece intacto. O resultado é uma nova planilha.</span></div>
  </main>
  <footer><span>Geo Prisma <span className="footer-divider">/</span> Uma ferramenta ANALITX</span><span>Dados que encontram seu lugar.</span></footer>
  <dialog ref={dialog} onCancel={() => setHelp(false)} onClick={e => { if (e.target === dialog.current) setHelp(false); }} aria-labelledby="help-title"><div className="dialog-heading"><h2 id="help-title">Do Excel ao mapa.</h2><button className="icon-button" onClick={() => setHelp(false)} aria-label="Fechar ajuda"><X size={21}/></button></div><ol className="help-list"><li><strong>Importe sua base</strong><p>Use um .xlsx de até 5 MB, com a aba Base e as colunas cep, city, latitude e longitude. Também aceitamos postcode no lugar de cep.</p></li><li><strong>Confira e geocodifique</strong><p>Consultamos cada combinação de CEP e cidade uma única vez. A duração depende do tamanho da base e da disponibilidade do serviço.</p></li><li><strong>Baixe o resultado</strong><p>As coordenadas completas são preservadas. Uma aba de relatório lista o que precisa de revisão. Confira a precisão antes de usar os pontos em análises.</p></li></ol><div className="help-footnote">As coordenadas representam localidades, não necessariamente o prédio de cada estabelecimento. Geocodificação: Photon. Dados © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>.</div><button className="primary-button" onClick={() => setHelp(false)}>Entendi <Check size={17}/></button></dialog>
 </div>;
}
