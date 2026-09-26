/* ===================================================================
   通用工具函数
=================================================================== */
function $(id){return document.getElementById(id);}

function esc(s){
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtHp(v){
  v=Math.round(v*2)/2;
  return Number.isInteger(v)?String(v):v.toFixed(1);
}