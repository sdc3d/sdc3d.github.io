/* ===================================================================
   Canvas 渲染
=================================================================== */

/* 改动：新增 showState 参数
 *   showState=true  → 允许显示该层的状态细节（机器进度、箱子开关）
 *   showState=false → 只画地形骨架，状态细节隐藏（跨楼层透视修复）
 */
function renderTile(ctx,x,y,ter,z,viewerIsKiller,showState){
  if(showState===undefined) showState = true;
  if(ter===T.VOID) return;

  ctx.fillStyle=TC[ter];
  ctx.fillRect(x*CELL,y*CELL,CELL,CELL);

  if(ter===T.GRASS){
    ctx.fillStyle='#1a4a1a';
    for(let i=0;i<4;i++) ctx.fillRect(x*CELL+6+i*8,y*CELL+6+(i%2)*10,4,6);
  }
  if(ter===T.WATER){
    ctx.strokeStyle='rgba(120,200,255,.4)';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(x*CELL+4,y*CELL+CELL/2);ctx.lineTo(x*CELL+CELL-4,y*CELL+CELL/2);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x*CELL+4,y*CELL+CELL/2+8);ctx.lineTo(x*CELL+CELL-4,y*CELL+CELL/2+8);ctx.stroke();
  }
  if(ter===T.GEN){
    const key=progressKey(z,x,y);
    const prog=G.genProgress[key]||0;
    ctx.fillStyle='#fff';ctx.font='bold 10px sans-serif';ctx.textAlign='center';
    ctx.fillText('⚙',x*CELL+CELL/2,y*CELL+15);
    /* 只有 showState=true 且（逃生者视角 或 屠夫与该机器同层/站在连接该层的楼梯上）才显示进度 */
    const showProgress = showState && (!viewerIsKiller || killerNearGen(z,x,y));
    if(showProgress){
      ctx.fillStyle='#000';ctx.fillRect(x*CELL+4,y*CELL+CELL-10,CELL-8,6);
      ctx.fillStyle=prog>=GEN_NEED?'#0f0':'#f80';
      ctx.fillRect(x*CELL+4,y*CELL+CELL-10,(CELL-8)*Math.min(1,prog/GEN_NEED),6);
      ctx.fillStyle='#fff';ctx.font='bold 8px sans-serif';
      ctx.fillText(prog+'/'+GEN_NEED,x*CELL+CELL/2,y*CELL+CELL-12);
    }
  }
  if(ter===T.CHEST){
    const bx=x*CELL, by=y*CELL;
    /* showState=false 时，一律按"关闭的箱子"绘制，屠夫无从分辨开关状态 */
    const opened = showState && G.chestsOpened.has(progressKey(z,x,y));
    if(!opened){
      ctx.fillStyle='#8a5a30';
      ctx.fillRect(bx+7,by+11,CELL-14,CELL-19);
      ctx.fillStyle='#b07a40';
      ctx.fillRect(bx+7,by+11,CELL-14,6);
      ctx.fillStyle='#ffd700';
      ctx.fillRect(bx+CELL/2-2,by+15,4,6);
      ctx.strokeStyle='#3a2a10';ctx.lineWidth=1;
      ctx.strokeRect(bx+7,by+11,CELL-14,CELL-19);
    } else {
      ctx.fillStyle='#4a3218';
      ctx.fillRect(bx+7,by+18,CELL-14,CELL-12);
      ctx.fillStyle='#8a5a30';
      ctx.beginPath();
      ctx.moveTo(bx+7,by+18);ctx.lineTo(bx+13,by+9);
      ctx.lineTo(bx+CELL-13,by+9);ctx.lineTo(bx+CELL-7,by+18);
      ctx.closePath();ctx.fill();
      ctx.strokeStyle='#3a2a10';ctx.lineWidth=1;
      ctx.strokeRect(bx+7,by+18,CELL-14,CELL-12);
      ctx.fillStyle='#999';ctx.font='bold 9px sans-serif';ctx.textAlign='center';
      ctx.fillText('空',bx+CELL/2,by+CELL/2+8);
    }
  }
  if(ter===T.WINDOW){
    const dir=windowDirAt(z,x,y)||'v';
    const cx=x*CELL+CELL/2, cy=y*CELL+CELL/2;
    ctx.fillStyle='#6ab0e0';
    ctx.strokeStyle='#3a6a9a';
    ctx.lineWidth=2;
    if(dir==='v'){
      ctx.fillRect(cx-4,cy-13,8,26);
      ctx.strokeRect(cx-4,cy-13,8,26);
      ctx.strokeStyle='rgba(255,255,255,0.55)';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(cx-2,cy-11);ctx.lineTo(cx-2,cy+11);ctx.stroke();
    } else {
      ctx.fillRect(cx-13,cy-4,26,8);
      ctx.strokeRect(cx-13,cy-4,26,8);
      ctx.strokeStyle='rgba(255,255,255,0.55)';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(cx-11,cy-2);ctx.lineTo(cx+11,cy-2);ctx.stroke();
    }
  }
  if(ter===T.STAIRS){
    ctx.strokeStyle='#dba';ctx.lineWidth=2;
    for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(x*CELL+6,y*CELL+10+i*8);ctx.lineTo(x*CELL+CELL-6,y*CELL+10+i*8);ctx.stroke();}
  }
  if(ter===T.HOLE){
    ctx.fillStyle='#000';ctx.beginPath();ctx.arc(x*CELL+CELL/2,y*CELL+CELL/2,CELL/2-6,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#6a3a8a';ctx.lineWidth=2;ctx.stroke();
  }
  if(ter===T.EXIT){
    const dp=doorProg(x,y,z),open=dp>=DOOR_NEED;
    /* 大门同样需要 showState 才显示真实状态 */
    if(!showState){
      ctx.fillStyle='#600';
      ctx.fillRect(x*CELL+6,y*CELL+6,CELL-12,CELL-12);
      ctx.fillStyle='#888';ctx.font='bold 11px sans-serif';ctx.textAlign='center';
      ctx.fillText('?',x*CELL+CELL/2,y*CELL+CELL/2+4);
    }else{
      ctx.fillStyle=open?'#0a8a4a':G.genTotal>=GEN_TO_OPEN?'#a85':'#600';
      ctx.fillRect(x*CELL+6,y*CELL+6,CELL-12,CELL-12);
      ctx.fillStyle='#fff';ctx.font='bold 11px sans-serif';ctx.textAlign='center';
      ctx.fillText(open?'开':(G.genTotal>=GEN_TO_OPEN?dp+'/'+DOOR_NEED:'锁'),x*CELL+CELL/2,y*CELL+CELL/2+4);
    }
  }
  ctx.strokeStyle='#333';ctx.lineWidth=1;ctx.strokeRect(x*CELL,y*CELL,CELL,CELL);
}

/* 绘制一个整层 */
function drawFloor(ctx,z,alpha,viewerIsKiller,showState){
  const grid=G.mapsByZ.get(z);
  if(!grid) return;
  const a=ctx.globalAlpha;
  ctx.globalAlpha=alpha;
  for(let y=0;y<MAP_H;y++) for(let x=0;x<MAP_W;x++){
    const t=grid[y][x];
    if(t===T.VOID) continue;
    renderTile(ctx,x,y,t,z,viewerIsKiller,showState);
  }
  ctx.globalAlpha=a;
}

function drawPlayer(ctx,pl,isCur,r){
  const cx=pl.x*CELL+CELL/2,cy=pl.y*CELL+CELL/2;
  r=r||(CELL/2-5);
  ctx.fillStyle=pl.color;
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle=isCur?'#ff0':'#fff';ctx.lineWidth=2;ctx.stroke();
  ctx.fillStyle='#fff';
  ctx.font='bold '+Math.max(7,Math.round(r*0.8))+'px sans-serif';
  ctx.textAlign='center';ctx.textBaseline='middle';
  const label=pl.role==='killer'?'屠':String(pl.slot+1);
  ctx.fillText(label,cx,cy);
  ctx.textBaseline='alphabetic';
  if(pl.role==='survivor'){
    if(pl.health<=0){ctx.fillStyle='#f00';ctx.font='bold 11px sans-serif';ctx.fillText('倒',cx,cy-r-2);}
    else if(pl.health<pl.maxHp){ctx.fillStyle='#fa0';ctx.font='bold 11px sans-serif';ctx.fillText('伤',cx,cy-r-2);}
    if(pl.bloodMark){
      ctx.fillStyle='#b060ff';ctx.strokeStyle='#fff';ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(cx+r-3,cy-r+3,6,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#fff';ctx.font='bold 8px sans-serif';ctx.fillText('令',cx+r-3,cy-r+6);
    }
  }
  if(isCur){ctx.fillStyle='#ff0';ctx.font='8px sans-serif';ctx.fillText('▼',cx,cy-r-6);}
}

function render(){
  const cv=document.getElementById('cv');
  cv.width=MAP_W*CELL;cv.height=MAP_H*CELL;
  const ctx=cv.getContext('2d');
  const {kv:kt,obs}=viewCtx();
  const cp=curPlayer();
  const obsZ=getEffectiveViewFloor();

  ctx.clearRect(0,0,MAP_W*CELL,MAP_H*CELL);

  /* 屠夫能"详细看到"的楼层集合；逃生者保持原行为（全部可见） */
  const killerFloors = kt ? getKillerVisibleFloors() : null;

  /* 先画所有楼层。当前视图楼层 alpha=1.0，其余淡化。 */
  const zs=getExistingFloors();
  for(const z of zs){
    const isCurrent = (z === obsZ);
    let showState = true;
    if(kt){
      /* 屠夫：只有本人所在层 + 通过楼梯连通的那一层才显示状态细节 */
      showState = killerFloors.has(z);
    }else{
      /* 逃生者：维持旧行为（显示状态）—— 若将来也需限制可在此处调整 */
      showState = true;
    }
    drawFloor(ctx,z,isCurrent?1.0:0.20,kt,showState);
  }

  /* 视野遮罩：仅作用于当前渲染楼层（屠夫） */
  if(kt){
    const grid=G.mapsByZ.get(obsZ);
    if(grid){
      for(let y=0;y<MAP_H;y++) for(let x=0;x<MAP_W;x++){
        if(grid[y][x]===T.VOID) continue;
        if(!isVisible(x,y,obs)){ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fillRect(x*CELL,y*CELL,CELL,CELL);}
      }
    }
    const half=Math.floor(G.killerVision/2);
    ctx.strokeStyle='rgba(255,230,100,0.35)';ctx.lineWidth=2;
    ctx.strokeRect((obs.x-half)*CELL,(obs.y-half)*CELL,(half*2+1)*CELL,(half*2+1)*CELL);
  }

  /* 窄墙：方块的一条边呈白色，无法通过（按楼层绘制） */
  if(G.narrowWalls&&G.narrowWalls.size){
    ctx.save();
    ctx.strokeStyle='#ffffff';
    ctx.lineWidth=3;
    ctx.lineCap='round';
    ctx.shadowColor='rgba(255,255,255,.85)';
    ctx.shadowBlur=5;
    for(const key of G.narrowWalls){
      const nw=parseNwKey(key);
      if(!nw||nw.z!==obsZ) continue;
      ctx.beginPath();
      if(nw.dir==='h'){
        ctx.moveTo(nw.x*CELL,(nw.y+1)*CELL);
        ctx.lineTo((nw.x+1)*CELL,(nw.y+1)*CELL);
      }else{
        ctx.moveTo((nw.x+1)*CELL,nw.y*CELL);
        ctx.lineTo((nw.x+1)*CELL,(nw.y+1)*CELL);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 板子：仅地面显示 */
  if(obsZ===0){
    for(const [key,st] of G.boards){
      const [bx,by]=key.split(',').map(Number);
      if(!kt||isVisible(bx,by,obs)){
        if(st==='open'){
          ctx.fillStyle='#a06a30';ctx.fillRect(bx*CELL+4,by*CELL+4,CELL-8,CELL-8);
          ctx.strokeStyle='#5a3a10';ctx.lineWidth=2;ctx.strokeRect(bx*CELL+4,by*CELL+4,CELL-8,CELL-8);
          ctx.beginPath();ctx.moveTo(bx*CELL+4,by*CELL+CELL/2);ctx.lineTo(bx*CELL+CELL-4,by*CELL+CELL/2);ctx.stroke();
        }else{
          ctx.strokeStyle='rgba(138,106,48,0.75)';ctx.lineWidth=2;
          ctx.strokeRect(bx*CELL+5,by*CELL+5,CELL-10,CELL-10);
          ctx.fillStyle='#8a6a30';ctx.font='10px sans-serif';ctx.textAlign='center';
          ctx.fillText('板',bx*CELL+CELL/2,by*CELL+CELL/2+4);
        }
      }
    }
  }
  /* 出生点：仅地面显示 */
  if(obsZ===0&&G.spawnTiles){
    for(const key of G.spawnTiles){
      const [sx,sy]=key.split(',').map(Number);
      ctx.strokeStyle='rgba(255,215,0,0.8)';ctx.lineWidth=2;ctx.setLineDash([5,3]);
      ctx.strokeRect(sx*CELL+2,sy*CELL+2,CELL-4,CELL-4);
      ctx.setLineDash([]);
    }
  }
  /* 楼梯重叠提示（地面显示时若有上层楼梯） */
  if(obsZ===0&&G.mapsByZ){
    for(let y=0;y<MAP_H;y++) for(let x=0;x<MAP_W;x++){
      const t0=getTerrainAt(0,x,y);
      if(t0!==T.STAIRS) continue;
      if(!hasStackedStairs(x,y)) continue;
      const cx=x*CELL+CELL/2, cy=y*CELL+CELL/2;
      ctx.strokeStyle='rgba(255,215,0,0.85)';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(cx,cy,CELL/2-6,0,Math.PI*2);ctx.stroke();
      ctx.strokeStyle='rgba(120,200,255,0.9)';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(cx,cy,CELL/2-10,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='rgba(255,215,0,0.9)';ctx.font='bold 8px sans-serif';ctx.textAlign='center';
      ctx.fillText('Z+1',cx,cy-2);
    }
  }
  /* 屠夫路径（仅当前层） */
  if(G.killerPath&&G.killerPath.length>1&&(G.killerPath[0].z|0)===obsZ){
    ctx.strokeStyle='rgba(233,69,96,0.55)';
    ctx.lineWidth=3;ctx.setLineDash([6,4]);
    ctx.beginPath();
    ctx.moveTo(G.killerPath[0].x*CELL+CELL/2,G.killerPath[0].y*CELL+CELL/2);
    for(let i=1;i<G.killerPath.length;i++){
      ctx.lineTo(G.killerPath[i].x*CELL+CELL/2,G.killerPath[i].y*CELL+CELL/2);
    }
    ctx.stroke();ctx.setLineDash([]);
    for(const pt of G.killerPath){
      ctx.fillStyle='rgba(233,69,96,0.7)';
      ctx.beginPath();ctx.arc(pt.x*CELL+CELL/2,pt.y*CELL+CELL/2,3,0,Math.PI*2);ctx.fill();
    }
  }

  /* 玩家（仅当前层）。
   * canSeePlayer 已处理屠夫跨楼层透视：
   *   - 逃生者所在层 != 屠夫所在层 且 屠夫未站在连通楼梯上 → 不可见
   */
  const playerGroups={};
  for(const pl of G.players){
    if(pl.health<0||pl.escaped) continue;
    if((pl.floor||0)!==obsZ) continue;
    if(!canSeePlayer(obs,kt,pl)) continue;
    const gk=pl.x+','+pl.y;
    if(!playerGroups[gk]) playerGroups[gk]=[];
    playerGroups[gk].push(pl);
  }
  for(const gk in playerGroups){
    const list=playerGroups[gk];
    list.sort((a,b)=>{
      if(a.id===cp.id) return 1;
      if(b.id===cp.id) return -1;
      return a.id-b.id;
    });
    list.forEach((pl,i)=>{
      const r=Math.max(6, CELL/2-5-i*4);
      drawPlayer(ctx,pl,pl.id===cp.id,r);
    });
  }
  /* 木偶（仅当前层） */
  const magician=G.players.find(pl=>pl.charId==='magician'&&pl.role==='survivor');
  for(const q of G.puppets){
    if((q.floor||0)!==obsZ) continue;
    if(kt){
      if(!isVisible(q.x,q.y,obs)) continue;
      if(magician) drawPlayer(ctx,{x:q.x,y:q.y,color:magician.color,slot:magician.slot,role:'survivor',health:2,maxHp:2},false);
    }else{
      const cx=q.x*CELL+CELL/2,cy=q.y*CELL+CELL/2;
      ctx.font='20px sans-serif';ctx.textAlign='center';
      ctx.fillText('🪆',cx,cy+7);
    }
  }
  /* 当前玩家高亮 */
  if(!G.gameOver&&(cp.floor||0)===obsZ&&canSeePlayer(obs,kt,cp)){
    ctx.strokeStyle='#ff0';ctx.lineWidth=2;
    ctx.strokeRect(cp.x*CELL,cp.y*CELL,CELL,CELL);
  }
  /* 开发者模式：标出不可进入格 */
  if(DEV.on){
    const grid=G.mapsByZ.get(DEV.editFloor||0);
    if(grid){
      for(let y=0;y<MAP_H;y++) for(let x=0;x<MAP_W;x++){
        const t=grid[y][x];
        if(t===T.VOID) continue;
        if(!isBlockedTerrain(t)) continue;
        ctx.strokeStyle='rgba(255,215,0,.30)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(x*CELL+2,y*CELL+2);ctx.lineTo(x*CELL+CELL-2,y*CELL+CELL-2);ctx.stroke();
        ctx.beginPath();ctx.moveTo(x*CELL+CELL-2,y*CELL+2);ctx.lineTo(x*CELL+2,y*CELL+CELL-2);ctx.stroke();
      }
    }
  }
}