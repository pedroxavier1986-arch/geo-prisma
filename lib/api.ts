import type { GeoResult, Place } from './workbook';
const endpoint = process.env.NEXT_PUBLIC_GEO_API_URL;
const sessionStorageKey = 'geo-prisma-session';
export function isConfigured() { return Boolean(endpoint); }
export function sessionKey() {
 let key = localStorage.getItem(sessionStorageKey);
 if (!key) { key = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem(sessionStorageKey, key); }
 return key;
}
export type Job = { id: string; filename: string; status: string; total: number; completed: number; succeeded: number; failed: number; created_at: string; message?: string };
export async function request<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
 if (!endpoint) throw new Error('O processamento está sendo configurado. A importação e o modelo já estão disponíveis.');
 const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-key': sessionKey() }, body: JSON.stringify({ action, ...payload }), signal: AbortSignal.timeout(30000) });
 const body = await response.json();
 if (!response.ok) throw new Error(body.error || 'Não foi possível conectar. Tente novamente.');
 return body as T;
}
export async function createJob(file: File, places: Place[]) {
 const prepared = await request<{ id: string; uploadUrl: string }>('prepare', { filename: file.name, bytes: file.size });
 const upload = await fetch(prepared.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: file });
 if (!upload.ok) throw new Error('Não foi possível enviar a planilha. Tente novamente.');
 await request('start', { id: prepared.id, places });
 return prepared.id;
}
export const getJob = (id: string) => request<{ job: Job; results: GeoResult[] }>('status', { id });
export const getHistory = () => request<{ jobs: Job[] }>('history');
export const getOriginal = (id: string) => request<{ url: string }>('original', { id });
