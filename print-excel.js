/* Editable OOXML workbook: retain printed merges, semantic colors and A4 setup. */
(function(global){
  'use strict';
  global.JFDT_PRINT_EXCEL=function(table,metadata,personal,rules){
    var X=global.XLSX,clone=table.cloneNode(true);
    clone.querySelectorAll('button').forEach(function(b){b.remove();});
    var source=X.utils.table_to_sheet(clone,{raw:true}),data=X.utils.sheet_to_json(source,{header:1,defval:''}),columnCount=10;
    var ws=X.utils.aoa_to_sheet([['课堂分组与加分记录表'],[metadata]].concat(data));
    Array.from(table.rows).forEach(function(tr,i){var name=tr.querySelector('.member-name-cell');if(name)ws['B'+(i+3)]={t:'s',v:name.textContent.trim().replace(/\s+/g,' ')};});
    for(var r=2;r<data.length+2;r++)for(var c=0;c<columnCount;c++){var address=X.utils.encode_cell({r:r,c:c});if(!ws[address]||ws[address].t==='z'||ws[address].v==='')ws[address]={t:'s',v:' '};}
    ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:9}},{s:{r:1,c:0},e:{r:1,c:9}}].concat((source['!merges']||[]).map(function(m){return {s:{r:m.s.r+2,c:m.s.c},e:{r:m.e.r+2,c:m.e.c}};}));
    var measured=Array.from(table.querySelectorAll('colgroup col')).map(function(c){return Number(c.dataset.contentWidth)||100;});
    ws['!cols']=measured.map(function(w){return {wch:Math.round(w/7*10)/10};});
    ws['!rows']=[{hpt:26},{hpt:24}].concat(data.map(function(row,i){return {hpt:i===0?28:i>=data.length-2?24:12.5};}));
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
        var id=0,r=Number(row);if(n===1){id=r===1?10:r===2?11:r===3?1:col==='A'?9:col==='B'?2:col==='C'||col==='E'?3:col==='D'?0:col==='F'?4:col==='G'?5:col==='H'?6:col==='I'?7:8;}else if(n===3){id=ruleLines[r-1].heading?(r===1?10:1):0;}else id=r===1?1:0;
        return '<c'+attrs.replace(/\s+s="\d+"/g,'')+' s="'+id+'">';
      });
      var setup='<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.3" bottom="0.3" header="0.1" footer="0.1"/><pageSetup paperSize="9" orientation="'+(n===2?'landscape':'portrait')+'" fitToWidth="1" fitToHeight="1"/>';
      xml=xml.replace('<sheetPr>','<sheetPr><pageSetUpPr fitToPage="1"/>');if(!xml.includes('<sheetPr>'))xml=xml.replace(/(<worksheet[^>]*>)/,'$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
      xml=xml.replace(/<printOptions\b[^>]*\/>|<pageMargins\b[^>]*\/>|<pageSetup\b[^>]*\/>/g,'').replace('</worksheet>',setup+'</worksheet>');set(path,xml);
    }
    return X.CFB.write(zip,{type:'array',fileType:'zip',compression:true});
  };

  global.JFDT_GROUP_EXCEL=function(html){
    var X=global.XLSX,box=document.createElement('div');box.innerHTML=html;var wb=X.utils.book_new(),types=[];
    box.querySelectorAll('.leader-paper').forEach(function(paper,page){
      var data=[],merges=[],kinds=[],width=0,heights=[];
      paper.querySelectorAll('.leader-slip').forEach(function(slip){
        var table=slip.querySelector('table'),rows=Array.from(table.rows),cols=rows[0].cells.length;width=cols;
        function merged(text,kind,height){var r=data.length;data.push([text]);merges.push({s:{r:r,c:0},e:{r:r,c:cols-1}});kinds.push(kind);heights.push({hpt:height});}
        merged(slip.querySelector('h2').textContent,0,16);merged(slip.querySelector('.slip-meta').textContent,0,12);
        rows.forEach(function(tr,i){data.push(Array.from(tr.cells).map(function(td){var clone=td.cloneNode(true);clone.querySelectorAll('small').forEach(function(x){x.before(' / ');});var text=clone.textContent.trim();return /^-?\d+(\.\d+)?$/.test(text)?Number(text):text||' ';}));kinds.push(i===0?1:2);heights.push({hpt:paper.children.length>=6?12:paper.children.length>=4?16:22});});
        merged(slip.querySelector('.slip-sign').textContent,0,12);merged(slip.querySelector('.slip-note').textContent,0,10);merged(' ',0,5);
      });
      var ws=X.utils.aoa_to_sheet(data);ws['!merges']=merges;ws['!cols']=[{wch:5},{wch:27}].concat(Array(Math.max(0,width-3)).fill({wch:Math.max(12,70/Math.max(1,width-3))}),[{wch:8}]);ws['!rows']=heights;X.utils.book_append_sheet(wb,ws,'第'+(page+1)+'页');types.push(kinds);
    });
    var zip=X.CFB.read(new Uint8Array(X.write(wb,{bookType:'xlsx',type:'array'})),{type:'array'}),enc=new TextEncoder(),dec=new TextDecoder();
    function set(path,text){var i=zip.FullPaths.findIndex(function(p){return p.endsWith('/'+path);});if(i<0)throw Error('Excel结构缺失');zip.FileIndex[i].content=enc.encode(text);zip.FileIndex[i].size=zip.FileIndex[i].content.length;}
    function get(path){return dec.decode(zip.FileIndex[zip.FullPaths.findIndex(function(p){return p.endsWith('/'+path);})].content);}
    var fills=['FFFFFF','D9E2F3','E2EFDA','EAF2FB','FFF2CC'];
    set('xl/styles.xml','<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="9"/><name val="Microsoft YaHei"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'+fills.map(function(c){return '<fill><patternFill patternType="solid"><fgColor rgb="FF'+c+'"/><bgColor indexed="64"/></patternFill></fill>';}).join('')+'</fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="5">'+fills.map(function(_,i){return '<xf fontId="0" fillId="'+(i+2)+'" borderId="'+(i?1:0)+'" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>';}).join('')+'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    types.forEach(function(kinds,i){var path='xl/worksheets/sheet'+(i+1)+'.xml',xml=get(path);xml=xml.replace(/<c\b([^>]*\br="([A-Z]+)(\d+)"[^>]*)>/g,function(all,attrs,col,row){var kind=kinds[Number(row)-1],id=kind===1?1:kind===2?(col==='A'||col==='B'?3:col===X.utils.encode_col(X.utils.decode_range(wb.Sheets[wb.SheetNames[i]]['!ref']).e.c)?4:2):0;return '<c'+attrs+' s="'+id+'">';});
      xml=xml.replace(/(<worksheet[^>]*>)/,'$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>').replace(/<pageMargins[^>]*\/>/g,'').replace('</worksheet>','<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.3" bottom="0.3" header="0" footer="0"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/></worksheet>');set(path,xml);
    });return X.CFB.write(zip,{type:'array',fileType:'zip',compression:true});
  };
})(window);
