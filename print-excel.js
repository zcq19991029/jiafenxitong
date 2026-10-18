/* Editable OOXML workbook: retain printed merges, semantic colors and A4 setup. */
(function(global){
  'use strict';
  global.JFDT_PRINT_EXCEL=function(table,metadata,personal,rules){
    var X=global.XLSX,clone=table.cloneNode(true);
    clone.querySelectorAll('.home-grade,.home-attendance').forEach(function(cell){
      if(cell.tagName==='TD')cell.textContent=Array.from(cell.children).map(function(row){return row.textContent.trim().replace(/\s+/g,' ');}).join('\n');
    });
    var source=X.utils.table_to_sheet(clone,{raw:true}),data=X.utils.sheet_to_json(source,{header:1,defval:''});
    var ws=X.utils.aoa_to_sheet([['课堂分组与加分记录表'],[metadata]].concat(data));
    for(var rowIndex=2;rowIndex<data.length+2;rowIndex++)for(var colIndex=0;colIndex<16;colIndex++){var address=X.utils.encode_cell({r:rowIndex,c:colIndex});if(!ws[address]||ws[address].t==='z'||ws[address].v==='')ws[address]={t:'s',v:' '};}
    table.querySelectorAll('tbody').forEach(function(group,index){
      var r=5+index*2;
      ['.home-attendance','.home-grade.regular','.home-grade.contribution','.home-grade.needed'].forEach(function(selector,i){var cell=group.querySelector(selector);if(!cell)return;var text=Array.from(cell.children).map(function(person,j){var strong=person.querySelector('strong');return (j+1)+'　'+(strong?strong.textContent:person.textContent).trim();}).join('\n');ws[['H','N','O','P'][i]+r]={t:'s',v:text};});
    });
    data.forEach(function(row,i){if(i<2||!row[0]||!/^\d+$/.test(String(row[0])))return;var r=i+3;['I','J','K','L'].forEach(function(col){var cell=ws[col+r];if(cell&&String(cell.v).trim()!==''&&Number.isFinite(Number(cell.v)))ws[col+r]={t:'n',v:Number(cell.v)};});ws['M'+r]={t:'n',f:'SUM(J'+r+':L'+r+')-I'+r,v:Number(row[12])||0};});
    ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:15}},{s:{r:1,c:0},e:{r:1,c:15}}].concat((source['!merges']||[]).map(function(m){return {s:{r:m.s.r+2,c:m.s.c},e:{r:m.e.r+2,c:m.e.c}};}));
    ws['!cols']=[{wch:5}].concat(Array(6).fill({wch:14}),[{wch:11},{wch:11},{wch:9},{wch:9},{wch:9},{wch:9},{wch:17},{wch:13},{wch:14}]);
    ws['!rows']=[{hpt:26},{hpt:24}].concat(data.map(function(r,i){return {hpt:i<2?30:Math.max(20,...r.map(function(v){return String(v).split('\n').length*7+5;}))};}));
    table.querySelectorAll('tbody').forEach(function(group,index){var lines=group.querySelector('.home-grade')?.children.length||3,half=Math.max(22,(lines*12+8)/2);ws['!rows'][4+index*2]={hpt:half};ws['!rows'][5+index*2]={hpt:half};});
    var wb=X.utils.book_new();X.utils.book_append_sheet(wb,ws,'本课加分表');
    var individual=X.utils.aoa_to_sheet(personal);individual['!cols']=Array(10).fill({wch:17});X.utils.book_append_sheet(wb,individual,'个人成绩');
    var ruleLines=Array.isArray(rules)?rules:[{text:'加分与换算说明',heading:true},{text:rules}];ruleLines=ruleLines.concat([{text:'本文件可继续编辑；修改不会自动回写网站。个人学期成绩为导出时快照，更新后请在网站重算并重新导出。'}]);
    var note=X.utils.aoa_to_sheet(ruleLines.map(function(r){return [r.text];}));note['!cols']=[{wch:140}];note['!rows']=ruleLines.map(function(r,i){return {hpt:r.heading?(i?24:30):Math.max(28,Math.ceil(r.text.length/100)*18)};});X.utils.book_append_sheet(wb,note,'规则说明');
    var zip=X.CFB.read(new Uint8Array(X.write(wb,{bookType:'xlsx',type:'array'})),{type:'array'}),enc=new TextEncoder(),dec=new TextDecoder();
    function entry(path){var i=zip.FullPaths.findIndex(function(p){return p.endsWith('/'+path);});if(i<0)throw new Error('Excel结构不完整：'+path);return zip.FileIndex[i];}
    function set(path,text){var e=entry(path);e.content=enc.encode(text);e.size=e.content.length;}
    var colors=['FFFFFF','D9E2F3','EAF2FB','FBE5E5','E2EFDA','FFF2CC','EDF5EE','EDF2FA','FCF0E9','BDD7EE'];
    var fonts=['<font><sz val="10"/><name val="Microsoft YaHei"/></font>','<font><b/><sz val="10"/><name val="Microsoft YaHei"/></font>','<font><b/><sz val="16"/><name val="Microsoft YaHei"/></font>'].concat(['236442','2F527A','A7472E'].map(function(c){return '<font><b/><sz val="11"/><color rgb="FF'+c+'"/><name val="Microsoft YaHei"/></font>';}));
    var specs=[[0,0],[1,1],[2,1],[3,0],[4,0],[5,1],[6,3],[7,4],[8,5],[9,1],[0,2],[0,0]];
    var styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="6">'+fonts.join('')+'</fonts><fills count="12"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'+colors.map(function(c){return '<fill><patternFill patternType="solid"><fgColor rgb="FF'+c+'"/><bgColor indexed="64"/></patternFill></fill>';}).join('')+'</fills><borders count="2"><border/><border><left style="thin"><color rgb="FFB4BBC4"/></left><right style="thin"><color rgb="FFB4BBC4"/></right><top style="thin"><color rgb="FFB4BBC4"/></top><bottom style="thin"><color rgb="FFB4BBC4"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="12">'+specs.map(function(s,i){return '<xf numFmtId="0" fontId="'+s[1]+'" fillId="'+(s[0]+2)+'" borderId="'+(i>=10?0:1)+'" xfId="0" applyAlignment="1" applyFill="1" applyFont="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>';}).join('')+'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    set('xl/styles.xml',styles);
    for(var n=1;n<=3;n++){
      var path='xl/worksheets/sheet'+n+'.xml',xml=dec.decode(entry(path).content);
      xml=xml.replace(/<c\b([^>]*\br="([A-Z]+)(\d+)"[^>]*)>/g,function(all,attrs,col,row){
        var id=0,r=Number(row);if(n===1){id=r===1?10:r===2?11:r<=4?1:col==='A'?9:/^[B-G]$/.test(col)?(r%2?2:3):col==='H'?0:col==='I'?3:/^[J-L]$/.test(col)?4:col==='M'?5:col==='N'?6:col==='O'?7:8;}else if(n===3){id=ruleLines[r-1].heading?(r===1?10:1):0;}else id=r===1?1:0;
        return '<c'+attrs.replace(/\s+s="\d+"/g,'')+' s="'+id+'">';
      });
      var setup='<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.3" bottom="0.3" header="0.1" footer="0.1"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1"/>';
      xml=xml.replace('<sheetPr>','<sheetPr><pageSetUpPr fitToPage="1"/>');if(!xml.includes('<sheetPr>'))xml=xml.replace(/(<worksheet[^>]*>)/,'$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
      xml=xml.replace(/<printOptions\b[^>]*\/>|<pageMargins\b[^>]*\/>|<pageSetup\b[^>]*\/>/g,'').replace('</worksheet>',setup+'</worksheet>');set(path,xml);
    }
    return X.CFB.write(zip,{type:'array',fileType:'zip',compression:true});
  };
})(window);
