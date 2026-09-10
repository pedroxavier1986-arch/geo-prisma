import ExcelJS from 'exceljs';

export type Place = { key: string; cep: string; city: string; address: string; number: string };
export type PreviewRow = { row: number; name: string; address: string; number: string; cep: string; city: string; latitude: number | null; longitude: number | null; key: string; issue?: string };
export type Inspection = { workbook: ExcelJS.Workbook; sheet: ExcelJS.Worksheet; columns: Record<string, number>; rows: PreviewRow[]; places: Place[]; total: number; pending: number; existing: number; invalid: number };
export type GeoResult = { key: string; latitude: number | null; longitude: number | null; status: string; provider?: string; reason?: string };

export function normalizeCep(value: string | number): string {
 const raw = String(value).trim().replace(/\.0$/, '');
 if (!/^\d{1,8}$/.test(raw) && !/^\d{5}-\d{3}$/.test(raw)) return '';
 const digits = raw.replace('-', '');
 return digits.padStart(8, '0');
}
export function placeKey(cep: string, city: string, address = ''): string {
 return `${cep}|${city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase()}|${address.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase()}`;
}
function coordinate(text: string, max: number): number | null {
 if (!text.trim()) return null;
 const n = Number(text.replace(',', '.'));
 return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}
export async function inspectWorkbook(data: ArrayBuffer): Promise<Inspection> {
 // Reject oversized expanded ZIPs before ExcelJS allocates the worksheet XML.
 const bytes = new Uint8Array(data);
 const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
 let end = -1;
 for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
  if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
 }
 if (end < 0) throw new Error('Não foi possível abrir este Excel. Envie um arquivo .xlsx válido e sem senha.');
 let cursor = view.getUint32(end + 16, true), expanded = 0;
 const entries = view.getUint16(end + 10, true);
 if (entries === 65535 || cursor === 4294967295) throw new Error('Esta planilha é grande demais. Divida o arquivo antes de importar.');
 for (let i = 0; i < entries; i++) {
  if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('O arquivo Excel está corrompido. Salve uma nova cópia e tente novamente.');
  expanded += view.getUint32(cursor + 24, true);
  if (expanded > 80 * 1024 * 1024) throw new Error('O conteúdo da planilha é grande demais. Divida o arquivo antes de importar.');
  cursor += 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
 }
 const workbook = new ExcelJS.Workbook();
 try { await workbook.xlsx.load(data); } catch { throw new Error('Não foi possível abrir este Excel. Envie um arquivo .xlsx válido e sem senha.'); }
 const sheet = workbook.getWorksheet('Base');
 if (!sheet) throw new Error('Não encontrei a aba “Base”. Renomeie a aba com os endereços para Base e tente novamente.');
 if (sheet.rowCount > 20001) throw new Error('Esta versão aceita até 20.000 linhas por planilha. Divida o arquivo e tente novamente.');
 const columns: Record<string, number> = {};
 sheet.getRow(1).eachCell((cell, index) => {
  const key = cell.text.trim().toLowerCase();
  if (columns[key]) throw new Error(`A coluna “${key}” aparece mais de uma vez.`);
  columns[key] = index;
 });
 if (!columns.cep && columns.postcode) columns.cep = columns.postcode;
 if (!columns.address) columns.address = columns.endereco || columns['endereço'] || columns.street || columns.logradouro;
 if (!columns.number) columns.number = columns.numero || columns['número'] || columns.house_number;
 const missing = ['address', 'number', 'cep', 'city', 'latitude', 'longitude'].filter(k => !columns[k]);
 if (missing.length) throw new Error(`Faltam colunas na aba Base: ${missing.join(', ')}.`);
 const rows: PreviewRow[] = [];
 const places = new Map<string, Place>();
 let existing = 0, invalid = 0, pending = 0;
 sheet.eachRow((row, i) => {
  if (i === 1 || !row.hasValues) return;
  const cep = normalizeCep(row.getCell(columns.cep).text);
  const city = row.getCell(columns.city).text.trim().replace(/\s+/g, ' ');
  const address = row.getCell(columns.address).text.trim().replace(/\s+/g, ' ');
  const number = row.getCell(columns.number).text.trim().replace(/\s+/g, ' ');
  const latitude = coordinate(row.getCell(columns.latitude).text, 90);
  const longitude = coordinate(row.getCell(columns.longitude).text, 180);
  const key = placeKey(cep, city, `${address} ${number}`);
  const complete = latitude !== null && longitude !== null;
  const issue = !complete && (!cep || !city || !address || !number) ? (!cep ? 'CEP inválido ou ausente' : !city ? 'Cidade ausente' : !address ? 'Endereço ausente' : 'Número ausente') : undefined;
  if (complete) existing++; else { pending++; if (issue) invalid++; else places.set(key, { key, cep, city, address, number }); }
  const nameColumn = columns.name || columns.nome;
  rows.push({ row: i, name: nameColumn ? row.getCell(nameColumn).text : `Registro ${i - 1}`, address, number, cep: cep || row.getCell(columns.cep).text, city, latitude, longitude, key, issue });
 });
 if (!rows.length) throw new Error('A aba Base está vazia. Inclua os endereços a partir da segunda linha.');
 if (places.size > 3000) throw new Error('Esta versão aceita até 3.000 localidades únicas. Divida a planilha em arquivos menores.');
 return { workbook, sheet, columns, rows, places: [...places.values()], total: rows.length, pending, existing, invalid };
}
export async function exportWorkbook(inspection: Inspection, results: GeoResult[]) {
 const workbook = new ExcelJS.Workbook();
 await workbook.xlsx.load(await inspection.workbook.xlsx.writeBuffer());
 const sheet = workbook.getWorksheet('Base')!;
 const lookup = new Map(results.map(r => [r.key, r]));
 const issues: (string | number)[][] = [];
 for (const row of inspection.rows) {
  if (row.latitude !== null && row.longitude !== null) continue;
  const result = lookup.get(row.key);
  if (result?.status === 'success' && result.latitude !== null && result.longitude !== null) {
   sheet.getCell(row.row, inspection.columns.latitude).value = result.latitude;
   sheet.getCell(row.row, inspection.columns.longitude).value = result.longitude;
  } else issues.push([row.row, row.cep, row.city, row.issue || result?.reason || 'Localidade não encontrada']);
 }
 let name = 'Geo Prisma - Relatório', suffix = 2;
 while (workbook.getWorksheet(name)) name = `Geo Prisma - Relatório ${suffix++}`;
 const report = workbook.addWorksheet(name);
 report.addRow(['Geo Prisma · ANALITX']);
 report.addRow(['Precisão', 'Coordenadas por CEP + cidade; não representam necessariamente o prédio.']);
 report.addRow(['Fonte', 'Photon / OpenStreetMap — https://www.openstreetmap.org/copyright']);
 report.addRow(['Linha na Base', 'CEP', 'Cidade', 'Pendência']);
 issues.forEach(row => report.addRow(row));
 if (!issues.length) report.addRow(['', '', '', 'Nenhuma pendência']);
 report.columns.forEach((column, i) => { column.width = [18, 22, 30, 65][i] || 24; });
 report.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
 report.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0066FF' } };
 return workbook.xlsx.writeBuffer();
}
export async function templateWorkbook() {
 const workbook = new ExcelJS.Workbook();
 const sheet = workbook.addWorksheet('Base');
 sheet.columns = ['name', 'address', 'number', 'cep', 'city', 'latitude', 'longitude'].map(key => ({ header: key, key, width: key === 'name' ? 30 : key === 'address' ? 42 : 20 }));
 sheet.getColumn('cep').numFmt = '@';
 sheet.addRow({ name: 'Estabelecimento de exemplo', address: 'Avenida Paulista', number: '1000', cep: '01311100', city: 'São Paulo' });
 sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
 sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0066FF' } };
 sheet.views = [{ state: 'frozen', ySplit: 1 }];
 return workbook.xlsx.writeBuffer();
}
