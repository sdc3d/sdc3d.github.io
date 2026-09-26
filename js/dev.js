/* ===================================================================
   开发者模式（地图编辑）
=================================================================== */
function toggleDev(){
  if(G&&G.netMode&&(!NET||!NET.host)){ netToast('仅房主可开启开发者模式'); return; }
  DEV.on=!DEV.on;
  const panel=document.getElementById('devPanel');
  panel.style.display=DEV.on?'block':'none';
  if(DEV.on){renderDevPalette();devRefreshFloorSel();}
  if(G) updateAll();
}
function renderDevPalette(){
  const el=document.getElementById('devPalette');
  if(!el)return;
  el.innerHTML=Object.keys(TN).filter(k=>Number(k)!==T.VOID).map(k=>{
    const t=Number(k);
    return '<div class="devTerr'+(DEV.terrain===t?' sel':'')+'" style="border-left:6px solid '+TC[t]+';" onclick="devPick('+t+')">'+TN[t]+(isBlockedTerrain(t)&&t!==T.WALL?' 🚫':'')+'</div>';
  }).join('');
}
function devPick(t){DEV.terrain=t;renderDevPalette();}

function devRefreshFloorSel(){
  const sel=document.getElementById('devFloorSel');
  if(!sel) return;
  sel.value = String(DEV.editFloor||0);
}
function devSwitchFloor(v){
  DEV.editFloor=parseInt(v);
  if(isNaN(DEV.editFloor)) DEV.editFloor=0;
  updateAll();
}
function devClearFloor(){
  if(!G) return;
  const z=DEV.editFloor||0;
  if(z===0){ netToast('地面层不能清空'); return; }
  G.mapsByZ.delete(z);
  G.windowDir.forEach((v,k)=>{ if(k.startsWith(z+':')) G.windowDir.delete(k); });
  G.chestItems.forEach((v,k)=>{ if(k.startsWith(z+':')) G.chestItems.delete(k); });
  G.chestsOpened.forEach(k=>{ if(k.startsWith(z+':')) G.chestsOpened.delete(k); });
  /* 一并清掉该层窄墙 */
  if(G.narrowWalls){
    for(const k of [...G.narrowWalls]){
      const nw=parseNwKey(k);
      if(nw&&nw.z===z) G.narrowWalls.delete(k);
    }
  }
  rebuildFloorLinks();
  reindexMap();
  if(G.netMode&&NET&&NET.host) net.dirty=true;
  updateAll();
  netToast('已清空 Z='+z+' 层');
}

function devEditTile(x,y){
  if(!G) return;
  if(G.netMode&&(!NET||!NET.host)){ netToast('仅房主可编辑地图'); return; }

  const chestSel=document.getElementById('devChestItem');
  if(chestSel) DEV.chestItem=chestSel.value;
  const spawnCk=document.getElementById('devSpawnTag');
  if(spawnCk) DEV.spawnTag=spawnCk.checked;
  const eraseCk=document.getElementById('devEraseMode');
  if(eraseCk) DEV.eraseMode=eraseCk.checked;
  const boardCk=document.getElementById('devBoardMode');
  if(boardCk) DEV.boardMode=boardCk.checked;
  const boardSel=document.getElementById('devBoardState');
  if(boardSel) DEV.boardState=boardSel.value;
  const wsel=document.getElementById('devWindowDir');
  if(wsel) DEV.windowDir=wsel.value;
  const narrowCk=document.getElementById('devNarrowMode');
  if(narrowCk) DEV.narrowMode=narrowCk.checked;
  const narrowSel=document.getElementById('devNarrowDir');
  if(narrowSel) DEV.narrowDir=narrowSel.value;

  const z=DEV.editFloor||0;
  const key=x+','+y;
  const commit=()=>{
    rebuildFloorLinks();
    reindexMap();
    if(G.netMode&&NET&&NET.host) net.dirty=true;
    updateAll();
  };

  /* 模式0：窄墙编辑（任意楼层） */
  if(DEV.narrowMode){
    const dir=DEV.narrowDir||'s';
    let ex=x, ey=y, ed='h';
    if(dir==='n'){ ey=y-1; ed='h'; }
    else if(dir==='s'){ ey=y; ed='h'; }
    else if(dir==='w'){ ex=x-1; ed='v'; }
    else { ex=x; ed='v'; }
    if(ex<0||ey<0||ex>=MAP_W||ey>=MAP_H){ netToast('❌ 该边超出地图范围'); return; }
    const added=toggleNarrowWall(z,ex,ey,ed);
    if(G.netMode&&NET&&NET.host) net.dirty=true;
    updateAll();
    netToast(added?'✔ 已放置白色窄墙（'+(ed==='h'?'下边':'右边')+' Z='+z+'）':'已移除窄墙');
    return;
  }

  /* 模式1：擦除 */
  if(DEV.eraseMode){
    if(z===0){
      if(getTerrainAt(0,x,y)===T.EMPTY){ netToast('地面空地无需删除'); return; }
      setTerrainAt(0,x,y,T.EMPTY);
    } else {
      if(getTerrainAt(z,x,y)===T.VOID){ netToast('该位置没有方块'); return; }
      setTerrainAt(z,x,y,T.VOID);
    }
    commit();
    return;
  }

  /* 模式2：出生点（仅 z=0） */
  if(DEV.spawnTag){
    if(z!==0){ netToast('出生点只能标记在地面'); return; }
    if(G.spawnTiles.has(key)) G.spawnTiles.delete(key);
    else {
      if(isBlockedTerrain(getTerrainAt(0,x,y))){ netToast('不可在阻挡地形上设置出生点'); return; }
      G.spawnTiles.add(key);
    }
    if(G.netMode&&NET&&NET.host) net.dirty=true;
    updateAll();
    return;
  }

  /* 模式3：板子编辑（仅 z=0） */
  if(DEV.boardMode){
    if(z!==0){ netToast('板子只能放在地面层'); return; }
    if(isBlockedTerrain(getTerrainAt(0,x,y))){ netToast('不可在阻挡地形上放板子'); return; }
    if(DEV.boardState==='none'){
      G.boards.delete(key);
      G.boardSpots.delete(key);
    } else {
      G.boards.set(key, DEV.boardState);
      G.boardSpots.add(key);
    }
    if(G.netMode&&NET&&NET.host) net.dirty=true;
    updateAll();
    return;
  }

  /* 模式4：地形放置 */
  const fkey=progressKey(z,x,y);
  const prevTer=getTerrainAt(z,x,y);

  /* 窗户合法性校验 */
  if(DEV.terrain===T.WINDOW){
    const dir=DEV.windowDir||'v';
    const up=getTerrainAt(z,x,y-1), down=getTerrainAt(z,x,y+1);
    const left=getTerrainAt(z,x-1,y), right=getTerrainAt(z,x+1,y);
    if(dir==='v' && !(up===T.WALL && down===T.WALL)){ netToast('❌ 竖直窗户要求上下都是墙'); return; }
    if(dir==='h' && !(left===T.WALL && right===T.WALL)){ netToast('❌ 水平窗户要求左右都是墙'); return; }
  }
  /* 地面层不允许放置虚空 */
  if(z===0 && DEV.terrain===T.VOID){ netToast('地面层不能有虚空'); return; }

  /* 非地面层若原本是虚空，放置地形会自动创建 */
  if(prevTer===DEV.terrain){
    if(DEV.terrain===T.CHEST) G.chestItems.set(fkey, DEV.chestItem);
    if(DEV.terrain===T.WINDOW) G.windowDir.set(fkey, DEV.windowDir);
    return;
  }

  setTerrainAt(z,x,y,DEV.terrain);
  if(DEV.terrain===T.CHEST) G.chestItems.set(fkey, DEV.chestItem);
  if(DEV.terrain===T.WINDOW) G.windowDir.set(fkey, DEV.windowDir);
  if(prevTer===T.WINDOW) G.windowDir.delete(fkey);
  if(prevTer===T.CHEST) G.chestItems.delete(fkey);

  /* 若在任意层放置楼梯，自动在 z+1 层创建一个平台，保证能上去 */
  if(DEV.terrain===T.STAIRS){
    const upZ=z+1;
    ensureFloorGrid(upZ);
    setTerrainAt(upZ,x,y,T.STAIRS);
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
      if(dx===0&&dy===0) continue;
      const nx=x+dx,ny=y+dy;
      if(nx<0||nx>=MAP_W||ny<0||ny>=MAP_H) continue;
      if(getTerrainAt(upZ,nx,ny)===T.VOID) setTerrainAt(upZ,nx,ny,T.EMPTY);
    }
  }
  pushOutPlayers(z,x,y);
  commit();
}

function devExportMap(){
  if(!G){netToast('尚未开始对局，无地图可导出');return;}
  const zs=[...G.mapsByZ.keys()].sort((a,b)=>a-b);
  let txt='// mapsByZ：Z→二维地形网格（Z=-1地下室，0地面，1二楼…）\nconst mapsByZData={\n';
  zs.forEach((z,i)=>{
    txt += '  "'+z+'":[\n';
    const grid=G.mapsByZ.get(z);
    for(let y=0;y<MAP_H;y++){
      let s='';
      for(let x=0;x<MAP_W;x++) s+=String(grid[y][x]);
      txt += '    "'+s+'"'+(y<MAP_H-1?',':'')+'\n';
    }
    txt += '  ]'+(i<zs.length-1?',':'')+'\n';
  });
  txt+='};\n';
  if(G.chestItems&&G.chestItems.size>0){
    const ciArr=[];
    for(const [k,v] of G.chestItems) ciArr.push('"'+k+':'+v+'"');
    txt+='const chestItemsData=['+ciArr.join(',')+'];\n';
  }
  if(G.spawnTiles&&G.spawnTiles.size>0){
    const spArr=[];
    for(const k of G.spawnTiles) spArr.push('"'+k+'"');
    txt+='const spawnTilesData=['+spArr.join(',')+'];\n';
  }
  if(G.windowDir&&G.windowDir.size>0){
    const wArr=[];
    for(const [k,v] of G.windowDir) wArr.push('"'+k+':'+v+'"');
    txt+='const windowDirData=['+wArr.join(',')+'];\n';
  }
  if(G.boards&&G.boards.size>0){
    const bArr=[];
    for(const [k,v] of G.boards) bArr.push('"'+k+':'+v+'"');
    txt+='const boardsData=['+bArr.join(',')+'];\n';
  }
  if(G.narrowWalls&&G.narrowWalls.size>0){
    const nArr=[];
    for(const k of G.narrowWalls) nArr.push('"'+k+'"');
    txt+='const narrowWallsData=['+nArr.join(',')+'];\n';
  }
  const out=document.getElementById('devOut');
  out.value=txt;
  out.select();
  try{document.execCommand('copy');}catch(e){}
  netToast('✔ 地图字符串已导出（每层独立，含箱子/出生点/窗户/板子/窄墙数据）');
}