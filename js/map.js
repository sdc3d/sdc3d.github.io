/* ===================================================================
   地图访问器 & 楼层索引
=================================================================== */
function getTerrainAt(z,x,y){
  const grid = G && G.mapsByZ ? G.mapsByZ.get(z|0) : null;
  if(!grid) return T.VOID;
  if(x<0||x>=MAP_W||y<0||y>=MAP_H) return T.VOID;
  return grid[y][x];
}
function setTerrainAt(z,x,y,t){
  let grid = G.mapsByZ.get(z|0);
  if(!grid){
    grid=[];
    for(let yy=0;yy<MAP_H;yy++){
      const row=[];
      for(let xx=0;xx<MAP_W;xx++) row.push(z===0?T.EMPTY:T.VOID);
      grid.push(row);
    }
    G.mapsByZ.set(z|0,grid);
  }
  if(x<0||x>=MAP_W||y<0||y>=MAP_H) return;
  grid[y][x]=t;
}
function ensureFloorGrid(z){
  z=z|0;
  if(!G.mapsByZ.has(z)){
    const grid=[];
    for(let y=0;y<MAP_H;y++){
      const row=[];
      for(let x=0;x<MAP_W;x++) row.push(z===0?T.EMPTY:T.VOID);
      grid.push(row);
    }
    G.mapsByZ.set(z,grid);
  }
}
function getExistingFloors(){
  return [...G.mapsByZ.keys()].sort((a,b)=>a-b);
}

/* ====================== 窗户方向 ====================== */
function windowDirAt(z,x,y){return G.windowDir?G.windowDir.get(progressKey(z,x,y)):null;}
function inferWindowDir(z,x,y){
  const up=getTerrainAt(z,x,y-1);
  const down=getTerrainAt(z,x,y+1);
  const left=getTerrainAt(z,x-1,y);
  const right=getTerrainAt(z,x+1,y);
  const vOK = up===T.WALL && down===T.WALL;
  const hOK = left===T.WALL && right===T.WALL;
  if(vOK && !hOK) return 'v';
  if(hOK && !vOK) return 'h';
  return vOK ? 'v' : (hOK ? 'h' : null);
}
function getWindowSide(z,wx,wy,px,py){
  const dir=windowDirAt(z,wx,wy);
  if(!dir) return 0;
  if(dir==='v'){
    if(px<wx) return -1;
    if(px>wx) return 1;
    return 0;
  }else{
    if(py<wy) return -1;
    if(py>wy) return 1;
    return 0;
  }
}
function killerNearGen(z,x,y){
  const k=G.players[G.killerId];
  if(!k||k.health<0) return false;
  if((k.floor||0)!==z) return false;
  return Math.max(Math.abs(k.x-x),Math.abs(k.y-y))===1;
}
function hasStackedStairs(x,y){
  let count=0;
  for(const [z,grid] of G.mapsByZ){
    if(grid[y] && grid[y][x]===T.STAIRS) count++;
  }
  return count>=2;
}

/* ====================== 楼梯/破洞连接重建 ====================== */
function rebuildFloorLinks(){
  const newStair=new Map(), newHole=new Map();
  for(const [z, grid] of G.mapsByZ){
    for(let y=0;y<MAP_H;y++) for(let x=0;x<MAP_W;x++){
      const t=grid[y][x];
      if(t===T.STAIRS){
        const upT=getTerrainAt(z+1,x,y);
        if(upT===T.STAIRS){
          newStair.set(cellKey3D(x,y,z),   {floor:z+1,x,y});
          newStair.set(cellKey3D(x,y,z+1), {floor:z,  x,y});
        }
      }
      if(t===T.HOLE){
        /* 洞向下贯穿虚空，落到第一个实体楼层 */
        let dest=null;
        for(let zz=z-1; zz>=z-20; zz--){
          const tt=getTerrainAt(zz,x,y);
          if(tt===T.VOID) continue;
          dest=zz; break;
        }
        if(dest!==null){
          newHole.set(cellKey3D(x,y,z), {floor:dest,x,y});
        }
      }
    }
  }
  G.stairLinks=newStair;
  G.holeLinks=newHole;
}

/* ====================== 地形索引重建 ====================== */
function reindexMap(){
  G.stairs=[];G.holes=[];G.gens=[];G.chests=[];G.exits=[];
  if(!G.chestItems) G.chestItems=new Map();
  if(!G.windowDir)  G.windowDir=new Map();
  if(!G.genProgress) G.genProgress={};
  if(!G.exitProgress) G.exitProgress={};

  for(const [z, grid] of G.mapsByZ){
    for(let y=0;y<MAP_H;y++) for(let x=0;x<MAP_W;x++){
      const t=grid[y][x];
      const key=progressKey(z,x,y);
      if(t===T.STAIRS) G.stairs.push([x,y,z]);
      if(t===T.HOLE)   G.holes.push([x,y,z]);
      if(t===T.GEN){
        G.gens.push([x,y,z]);
        if(!(key in G.genProgress)) G.genProgress[key]=0;
      }
      if(t===T.CHEST){
        G.chests.push([x,y,z]);
        if(!G.chestItems.has(key)) G.chestItems.set(key, Math.random()<0.5?'注射针':'医疗箱');
      }
      if(t===T.EXIT){
        G.exits.push([x,y,z]);
        if(!(key in G.exitProgress)) G.exitProgress[key]=0;
      }
      if(t===T.WINDOW && !G.windowDir.has(key)){
        const d=inferWindowDir(z,x,y);
        if(d) G.windowDir.set(key, d);
      }
    }
  }
}

/* ====================== 玩家挤出阻挡格 ====================== */
function pushOutPlayers(z,tx,ty){
  if(!isBlockedTerrain(getTerrainAt(z,tx,ty))) return;
  for(const pl of G.players){
    if(pl.health<0||pl.escaped) continue;
    if((pl.floor||0)!==z) continue;
    if(pl.x!==tx||pl.y!==ty) continue;
    let found=false;
    for(let r=1;r<12&&!found;r++){
      for(let dy=-r;dy<=r&&!found;dy++) for(let dx=-r;dx<=r&&!found;dx++){
        const nx=tx+dx,ny=ty+dy;
        if(nx<0||nx>=MAP_W||ny<0||ny>=MAP_H) continue;
        const t=getTerrainAt(z,nx,ny);
        if(t===T.VOID||isBlockedTerrain(t)) continue;
        pl.x=nx;pl.y=ny;found=true;
      }
    }
  }
}