import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { normalizeCep, placeKey, inspectWorkbook, exportWorkbook } from '../lib/workbook.ts';

test('normalizes numeric CEPs and rejects malformed values', () => {
 assert.equal(normalizeCep(1311100),'01311100');
 assert.equal(normalizeCep('01311-100'),'01311100');
 assert.equal(normalizeCep('1311100.0'),'01311100');
 assert.equal(normalizeCep('abc01311100'),'');
 assert.equal(placeKey('01311100','  SÃO  PAULO ','Rua A 10'),placeKey('01311100','São Paulo','Rua A 10'));
});
test('deduplicates places, repairs incomplete pairs, preserves complete data and other sheets', async () => {
 const w = new ExcelJS.Workbook(); const base=w.addWorksheet('Base');
 base.addRow(['name','postcode','city','address','number','latitude','longitude','custom']);
 base.addRow(['A','01311100','São Paulo','Avenida Paulista','1000',null,null,'keep']);
 base.addRow(['B',1311100,'SÃO PAULO','Avenida Paulista','1000',-20,null,'keep']);
 base.addRow(['C','01311100','São Paulo','Avenida Paulista','1000',-21,-42,'keep']);
 base.addRow(['D','broken','São Paulo','Avenida Paulista','1000',null,null,'keep']);
 base.getCell('F2').font={bold:true};
 w.addWorksheet('Other').getCell('A1').value={formula:'1+2',result:3};
 const inspection=await inspectWorkbook(await w.xlsx.writeBuffer() as unknown as ArrayBuffer);
 assert.equal(inspection.places.length,1); assert.equal(inspection.pending,3); assert.equal(inspection.invalid,1); assert.equal(inspection.existing,1);
 const result=await exportWorkbook(inspection,[{key:inspection.places[0].key,latitude:-23.56,longitude:-46.65,status:'success'}]);
 const output=new ExcelJS.Workbook(); await output.xlsx.load(result);
 assert.equal(output.getWorksheet('Base')!.getCell('F2').value,-23.56);
 assert.equal(output.getWorksheet('Base')!.getCell('G3').value,-46.65);
 assert.equal(output.getWorksheet('Base')!.getCell('F4').value,-21);
 assert.equal(output.getWorksheet('Base')!.getCell('G4').value,-42);
 assert.deepEqual(output.getWorksheet('Other')!.getCell('A1').value,{formula:'1+2',result:3});
 assert.ok(output.getWorksheet('Geo Prisma - Relatório')!.getRow(5).getCell(4).text.includes('CEP'));
 assert.equal(inspection.sheet.getCell('F2').value,null);
 assert.equal(inspection.workbook.worksheets.length,2);
});
test('rejects missing Base and incomplete headers', async () => {
 const w=new ExcelJS.Workbook(); w.addWorksheet('Wrong');
 await assert.rejects(inspectWorkbook(await w.xlsx.writeBuffer() as unknown as ArrayBuffer),/Base/);
 const w2=new ExcelJS.Workbook(); w2.addWorksheet('Base').addRow(['cep','city']);
 await assert.rejects(inspectWorkbook(await w2.xlsx.writeBuffer() as unknown as ArrayBuffer),/address, number, latitude, longitude/);
});



