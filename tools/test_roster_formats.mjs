import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx=vm.createContext({console});
vm.runInContext(fs.readFileSync(new URL('../vendor/xlsx.full.min.js',import.meta.url),'utf8'),ctx);
vm.runInContext(fs.readFileSync(new URL('../roster-import.js',import.meta.url),'utf8'),ctx);
for(const format of ['xlsx','xls','ods']){
  const wb=ctx.XLSX.utils.book_new();
  const rows=[['班级','姓名','学号','小组','班内序号'],['测试班','同名','001234567890',1,1],['测试班','同名','001234567891','',2]];
  ctx.XLSX.utils.book_append_sheet(wb,ctx.XLSX.utils.aoa_to_sheet(rows),'名单');
  const data=ctx.XLSX.write(wb,{bookType:format,type:'array'});
  const parsed=ctx.JFDT_ROSTER.workbook(data);
  assert.equal(parsed[0]['学号'],'001234567890');
  const result=ctx.JFDT_ROSTER.apply({classes:[],lessons:[],undo:[]},parsed,'教师');
  assert.equal(result.students,2);
  assert.equal(result.state.classes[0].groups[0].members.length,1);
  assert.equal(result.state.classes[0].roster.length,2);
  assert.throws(()=>ctx.JFDT_ROSTER.apply({classes:result.state.classes,lessons:[{classId:result.state.classes[0].id}]},parsed,''),/已有课次/);
  ctx.XLSX.utils.book_append_sheet(wb,ctx.XLSX.utils.aoa_to_sheet([rows[0],['另班','学生','002',1,1]]),'另一班');
  assert.equal(ctx.JFDT_ROSTER.workbook(ctx.XLSX.write(wb,{bookType:format,type:'array'})).length,3);
  console.log('PASS',format,'roundtrip, leading zero, same names, groups, pending, multi-sheet and lesson protection');
}
