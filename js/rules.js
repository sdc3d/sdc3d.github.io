/* ===================================================================
   规则查询（不修改状态，只读）
=================================================================== */
function doorProg(x,y,z){return G.exitProgress[progressKey(z,x,y)]||0;}
function isDoorOpen(x,y,z){
  if(getTerrainAt(z||0,x,y)!==T.EXIT) return false;
  return doorProg(x,y,z)>=DOOR_NEED;
}
function adjacent(p,x,y){return Math.max(Math.abs(x-p.x),Math.abs(y-p.y))===1;}

function downedAtSameTile(p){
  return G.players.find(s=>s.role==='survivor'&&s!==p&&!s.escaped&&s.health===0
    &&s.x===p.x&&s.y===p.y&&(s.floor||0)===(p.floor||0))||null;
}
function injuredAtSameTile(p){
  return G.players.find(s=>s.role==='survivor'&&s!==p&&!s.escaped&&s.health>0&&s.health<s.maxHp
    &&s.x===p.x&&s.y===p.y&&(s.floor||0)===(p.floor||0))||null;
}
function puppetAt(x,y,z){
  return G.puppets.find(q=>q.x===x&&q.y===y&&(q.floor||0)===(z||0))||null;
}

function hasNearbyClosedBoard(p){
  for(const [key,st] of G.boards){
    if(st!=='closed')continue;
    const [bx,by]=key.split(',').map(Number);
    if(Math.abs(bx-p.x)<=1&&Math.abs(by-p.y)<=1&&(Math.abs(bx-p.x)!==0||Math.abs(by-p.y)!==0)) return true;
  }
  return false;
}
function hasNearbyOpenBoard(p){
  for(const [key,st] of G.boards){
    if(st!=='open')continue;
    const [bx,by]=key.split(',').map(Number);
    if(Math.abs(bx-p.x)<=1&&Math.abs(by-p.y)<=1&&(Math.abs(bx-p.x)!==0||Math.abs(by-p.y)!==0)) return true;
  }
  return false;
}
function hasNearbyClosedChest(p){
  const z=p.floor||0;
  for(const [cx,cy,cz] of G.chests){
    if(cz!==z)continue;
    if(!adjacent(p,cx,cy))continue;
    if(getTerrainAt(z,cx,cy)!==T.CHEST)continue;
    if(G.chestsOpened.has(progressKey(z,cx,cy)))continue;
    return true;
  }
  return false;
}

/* ====================== 屠夫跨楼层视野 ======================
 * 屠夫站在连接 targetZ 的楼梯上时，可以"看到" targetZ 层的全部内容。
 * kZ：屠夫当前楼层   targetZ：想看的楼层
 */
function killerCanSeeFloorFromStairs(kZ, targetZ){
  if(kZ === targetZ) return true;
  const k = G.players[G.killerId];
  if(!k || k.health<0) return false;
  if((k.floor||0) !== kZ) return false;
  if(getTerrainAt(kZ, k.x, k.y) !== T.STAIRS) return false;
  const lk = stairLink3D(k.x, k.y, kZ);
  if(!lk) return false;
  return lk.floor === targetZ;
}

/* 屠夫当前能"详细看到（含状态：箱子/机器/玩家）"的楼层集合 */
function getKillerVisibleFloors(){
  const s = new Set();
  const k = G.players[G.killerId];
  if(!k || k.health<0) return s;
  const z = k.floor||0;
  s.add(z);
  if(getTerrainAt(z, k.x, k.y) === T.STAIRS){
    const lk = stairLink3D(k.x, k.y, z);
    if(lk) s.add(lk.floor);
  }
  return s;
}

/* ====================== 屠夫与电机的"接近"判定 ======================
 * 若屠夫与电机同层 → 按相邻判定
 * 若屠夫站在能连通电机所在层的楼梯上 → 也按相邻判定
 */
function killerNearGen(z,x,y){
  const k=G.players[G.killerId];
  if(!k||k.health<0) return false;
  const kZ = k.floor||0;
  if(kZ !== z && !killerCanSeeFloorFromStairs(kZ, z)) return false;
  return Math.max(Math.abs(k.x-x),Math.abs(k.y-y))===1;
}

function hasStackedStairs(x,y){
  let count=0;
  for(const [z,grid] of G.mapsByZ){
    if(grid[y] && grid[y][x]===T.STAIRS) count++;
  }
  return count>=2;
}

/* ====================== 视野 ====================== */
function isVisible(x,y,obs){
  obs=obs||curPlayer();
  if(obs.role==='killer'){
    const half=Math.floor(G.killerVision/2);
    if(Math.abs(x-obs.x)>half||Math.abs(y-obs.y)>half) return false;
    const obsZ=obs.floor||0;
    if(getTerrainAt(obsZ,x,y)===T.GRASS&&getTerrainAt(obsZ,obs.x,obs.y)!==T.GRASS) return false;
    return true;
  }
  return true;
}
function killerSeesTile(tx,ty){
  const k=G.players[G.killerId];
  if(!k||k.health<0) return false;
  const half=Math.floor(G.killerVision/2);
  if(Math.abs(tx-k.x)>half||Math.abs(ty-k.y)>half) return false;
  const kZ=k.floor||0;
  if(getTerrainAt(kZ,tx,ty)===T.GRASS&&getTerrainAt(kZ,k.x,k.y)!==T.GRASS) return false;
  return true;
}
function viewCtx(){
  if(G.netMode){const o=G.players[NET.slot];return {kv:o.role==='killer',obs:o};}
  return {kv:isKillerTurn(),obs:curPlayer()};
}
function getPlayerAt(x,y){
  const obs=curPlayer();
  for(const p of G.players)
    if(p.health>=0&&!p.escaped&&p.x===x&&p.y===y&&(p.floor||0)===(obs.floor||0)) return p;
  return null;
}
function getPlayerAtFloor(z,x,y){
  for(const p of G.players)
    if(p.health>=0&&!p.escaped&&(p.floor||0)===z&&p.x===x&&p.y===y) return p;
  return null;
}

/* ====================== 移动合法性 ====================== */
function canMoveTo(p,tx,ty,targetZ){
  if(tx<0||tx>=MAP_W||ty<0||ty>=MAP_H) return false;
  /* 修复：null/undefined 都视为「使用玩家当前楼层」 */
  const hasTarget=(targetZ!==undefined&&targetZ!==null);
  const z=hasTarget?targetZ:(p.floor||0);
  const ter=getTerrainAt(z,tx,ty);
  if(isBlockedTerrain(ter)) return false;
  if(z===0&&p.role==="killer"){
    if(G.boards.get(tx+","+ty)==="open") return false;
    if(puppetAt(tx,ty,0)) return false;
  }
  if(p.role==="killer"){
    if(ter===T.WINDOW){
      const side=getWindowSide(z,tx,ty,p.x,p.y);
      if(side===0) return false;
    }
    const srcTer=getTerrainAt(z,p.x,p.y);
    if(srcTer===T.WINDOW){
      const dstSide=getWindowSide(z,p.x,p.y,tx,ty);
      if(dstSide===0) return false;
    }
  }
  /* 玩家可经过、重叠，不再阻挡移动 */
  return true;
}

/* ====================== 窄墙判定 ======================
 * 修复：null 与 undefined 一律视为「使用玩家当前楼层」
 */
function narrowBlocked(p,tx,ty,targetZ){
  const z=(targetZ!==undefined&&targetZ!==null)?targetZ:(p.floor||0);
  const dx=tx-p.x,dy=ty-p.y;
  if(dx===0&&dy!==0){
    if(hasNarrowWall(z,tx,Math.min(p.y,ty),'h')) return true;
  }else if(dy===0&&dx!==0){
    if(hasNarrowWall(z,Math.min(p.x,tx),ty,'v')) return true;
  }
  return false;
}

function diagonalBlocked(p,tx,ty,targetZ){
  const dx=tx-p.x,dy=ty-p.y;
  if(dx===0||dy===0) return false;
  const mid1Blocked=!canMoveTo(p,p.x+dx,p.y,targetZ);
  const mid2Blocked=!canMoveTo(p,p.x,p.y+dy,targetZ);
  return mid1Blocked&&mid2Blocked;
}

/* ====================== 可见性（多人视角） ======================
 *  修复点：
 *   - 屠夫不能跨楼层看到逃生者；
 *   - 除非他本人就在该楼层，或站在连接该楼层的楼梯上。
 */
function canSeePlayer(obs,obsKiller,pl){
  if(pl.id===obs.id) return true;
  const _vz=getEffectiveViewFloor();
  if(_vz!==(pl.floor||0)) return false;
  /* 屠夫专用：拦掉跨楼层透视 */
  if(obsKiller && pl.role!=='killer'){
    const kZ = obs.floor||0;
    const pZ = pl.floor||0;
    if(kZ !== pZ && !killerCanSeeFloorFromStairs(kZ, pZ)) return false;
  }
  if(!G.gameOver&&curPlayer().role==='killer'&&pl.role==='killer') return true;
  if(obsKiller){
    if(pl.role==='killer') return true;
    return isVisible(pl.x,pl.y,obs);
  }
  if(pl.role!=='killer') return true;
  return killerSeesTile(obs.x,obs.y);
}