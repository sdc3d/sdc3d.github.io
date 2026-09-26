/* ===================================================================
   对局初始化 + 回合流转 + 胜负判定
=================================================================== */
function initGame(assign){
  /* 从 mapStr 解析出 z=0 的地面网格 */
  const grid0=[];
  for(let y=0;y<MAP_H;y++){
    const row=[];
    for(let x=0;x<MAP_W;x++) row.push(parseInt(mapStr[y][x]));
    grid0.push(row);
  }

  const kSlot=assign?assign.killerSlot:Math.floor(Math.random()*4);
  const names=(assign&&assign.names)?assign.names:(assign?lobby.map(p=>p.name):['玩家1','玩家2','玩家3','玩家4']);
  const picks=(assign&&assign.chars)?assign.chars:{};

  /* 收集初始地图上的元素坐标 */
  const stairs=[],holes=[];
  for(let y=0;y<MAP_H;y++) for(let x=0;x<MAP_W;x++){
    const t=grid0[y][x];
    if(t===T.STAIRS) stairs.push([x,y]);
    if(t===T.HOLE) holes.push([x,y]);
  }

  const players=[];
  const spawnTiles=new Set(['2,2','3,3','14,3','8,11']);
  const spawnPool=[...spawnTiles].map(k=>k.split(',').map(Number));
  for(let i=spawnPool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[spawnPool[i],spawnPool[j]]=[spawnPool[j],spawnPool[i]];}
  let spawnIdx=0;
  function nextSpawn(){return spawnPool[spawnIdx++]||[2,2];}
  for(let i=0;i<4;i++){
    const nm=names[i]||('玩家'+(i+1));
    if(i===kSlot){
      const ch=picks[i]?getChar('killer',picks[i]):CHARACTERS.killer[0];
      const sp=nextSpawn();
      players.push({id:i,slot:i,role:'killer',charId:ch.id,x:sp[0],y:sp[1],name:nm,color:'#e94560',
        ap:ch.ap,maxAp:ch.ap,health:1,contracts:0,fixing:false,committed:false,actedThisTurn:false,
        downTimer:0,escaped:false,floor:0,windowSide:0});
    }else{
      const ch=picks[i]?getChar('survivor',picks[i]):CHARACTERS.survivor[0];
      const sp=nextSpawn();
      players.push({id:i,slot:i,role:'survivor',charId:ch.id,x:sp[0],y:sp[1],name:nm,color:SLOT_COLORS[i],
        ap:ch.ap,maxAp:ch.ap,health:ch.hp,maxHp:ch.hp,bloodMark:false,
        downCount:0,downTimer:0,apBonusNext:0,apDebtNext:0,crossUsed:false,
        puppets:ch.id==='magician'?2:0,items:ch.id==='doctor'?['注射针']:[],
        fixing:false,fixedThisRound:false,committed:false,actedThisTurn:false,escaped:false,floor:0,windowSide:0});
    }
  }
  const killerId=kSlot;
  const survIds=players.filter(p=>p.role==='survivor').map(p=>p.id);

  G={
    mapsByZ:new Map(),
    /* 窄墙：键格式 "z:x,y,dir"  h=该格下边  v=该格右边 */
    narrowWalls:new Set([
      '0:5,6,h','0:7,11,h','0:8,4,v','0:4,13,v'
    ]),
    boards:new Map([['5,5','closed'],['12,5','closed'],['5,8','closed'],['12,8','closed'],['8,3','closed'],['9,10','closed'],['3,11','closed'],['14,11','closed']]),
    boardSpots:new Set(['5,5','12,5','5,8','12,8','8,3','9,10','3,11','14,11']),
    players,
    seqIdx:0,
    turnSequence:[...survIds,killerId],
    killerId,
    survIds,
    killerGold:50,
    killerVision:3,
    /* 视野扩展：0 表示未生效；>0 表示在第 G.round >= 该值 时到期 */
    killerVisionExpireRound:0,
    /* 瞬移：本局至多购买一次 */
    teleportBought:false,
    genProgress:{},
    genTotal:0,
    genRequired:GEN_TO_OPEN,
    exitProgress:{},
    exitOpen:false,
    rageRounds:0,
    rageActive:false,
    killerApDebt:0,
    lastRoundFixers:[],
    justFixedGens:[],
    puppets:[],
    chestsOpened:new Set(),
    chestItems:new Map(),
    windowDir:new Map(),
    spawnTiles,
    killerPath:[],
    log:[],
    gameOver:false,
    round:1,
    extraTurnIds:new Set(),
    stairs:[],holes:[],gens:[],chests:[],exits:[],
    shopItems:[
      {id:'vision',   name:'视野扩展5×5', cost:60, desc:'本回合起持续3回合（含购买回合）'},
      {id:'ap',       name:'行动点药水',  cost:40, desc:'本回合+3步'},
      {id:'teleport', name:'瞬移',        cost:80, desc:'传送到随机未修好的机器旁 · 本局限购1次'},
      {id:'healblock',name:'禁疗诅咒',    cost:50, desc:'本回合逃生者无法使用注射针/医疗箱'},
    ],
    healBlocked:false,
    servantUsedCount:0,
    servantBoost:true,
    netMode:!!(assign&&assign.netMode),
    endCamp:null,
    endReason:null,
    stairLinks:new Map(),
    holeLinks:new Map(),
  };

  /* 设置 z=0 地面网格 */
  G.mapsByZ.set(0, grid0);

  /* 处理破洞：从 z=0 移除、在 z=1 生成 */
  for(const [hx,hy] of holes){
    grid0[hy][hx]=T.EMPTY;
    ensureFloorGrid(1);
    setTerrainAt(1,hx,hy,T.HOLE);
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
      if(dx===0&&dy===0) continue;
      const nx=hx+dx,ny=hy+dy;
      if(nx<0||nx>=MAP_W||ny<0||ny>=MAP_H) continue;
      if(getTerrainAt(1,nx,ny)===T.VOID) setTerrainAt(1,nx,ny,T.EMPTY);
    }
  }
  /* 处理楼梯：在地面 z=0 处保持原样；同时在 z=1 处创建平台与对应楼梯 */
  for(const [sx,sy] of stairs){
    ensureFloorGrid(1);
    setTerrainAt(1,sx,sy,T.STAIRS);
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
      if(dx===0&&dy===0) continue;
      const nx=sx+dx,ny=sy+dy;
      if(nx<0||nx>=MAP_W||ny<0||ny>=MAP_H) continue;
      if(getTerrainAt(1,nx,ny)===T.VOID) setTerrainAt(1,nx,ny,T.EMPTY);
    }
  }

  rebuildFloorLinks();
  reindexMap();

  if(G.netMode){ NET={slot:assign.mySlot,host:!!assign.isHost,frozen:false}; }
  logMsg('身份分配完成！'+players[killerId].name+' 被随机选为屠夫（🔪），逃生者阵营先手。');
  for(const pl of players){
    const ch=getChar(pl.role,pl.charId);
    logMsg(pl.name+' → '+(pl.role==='killer'?'屠夫':'逃生者')+'·'+ch.icon+ch.name+'（步数'+ch.ap+(pl.role==='survivor'?'/血量'+ch.hp:'')+'，技能：'+ch.skills.map(s=>s.n).join('、')+'）');
  }
  logMsg('逃生者目标：修好'+GEN_TO_OPEN+'台机器（每台需'+GEN_NEED+'点）解锁并修开大门，≥2人逃脱即胜。');
  logMsg('修机/修门：在机器或大门【周围八格】点击对应格，消耗整回合+1点进度。');
  logMsg('开箱：逃生者在箱子周围八格点击箱子，消耗'+CHEST_AP+'步开箱。');
  logMsg('机器、箱子、大门所在格不可进入；大门需在相邻格点击撤离。');
  logMsg('⏭ 每回合不再自动结束：请在右侧「技能」栏点击「结束回合」按钮进入下一位玩家（攻击逃生者命中后屠夫回合立即结束）。');
  updateAll();
}

/* ====================== 当前玩家 ====================== */
function curPlayer(){return G.players[G.turnSequence[G.seqIdx]];}
function isKillerTurn(){return curPlayer().role==='killer';}

/* ====================== 状态文本 ====================== */
function isDown(s){return s.role==='survivor'&&s.health<=0;}
function isInjured(s){return s.role==='survivor'&&s.health>0&&s.health<s.maxHp;}
function isHealthy(s){return s.role==='survivor'&&s.health>=s.maxHp;}
function hpStateText(s){
  if(s.health<0)return ['已淘汰','#f00'];
  if(s.escaped)return ['已逃脱','#0f0'];
  if(s.health<=0)return ['倒地','#f00'];
  if(s.health>=s.maxHp)return ['健康','#0f0'];
  return ['受伤','#fa0'];
}

/* ====================== 回合行动点 ======================
 * 屠夫命中逃生者后 → G.killerApDebt=3（在 doAttack 中设置）
 * 被刀到的逃生者 → apBonusNext=3（在 doAttack 中设置）
 * 运动员疾跑 → crossUsed 每回合重置一次
 */
function applyTurnAp(pl){
  if(pl.role==='killer'){
    let ap=pl.maxAp;
    G.rageActive=false;
    if(G.rageRounds>0){G.rageRounds--;G.rageActive=true;ap+=3;logMsg('💢 大门开启使屠夫进入【狂暴】：本回合步数+3、伤害+1！');}
    if(G.killerApDebt>0){
      ap-=G.killerApDebt;
      logMsg('🩸 '+pl.name+'上回合成功命中逃生者，本回合步数 -'+G.killerApDebt+'（'+pl.maxAp+'→'+Math.max(0,ap)+'）');
      G.killerApDebt=0;
    }
    pl.ap=Math.max(0,ap);
  }else{
    const base=pl.health<=0?3:pl.maxAp;
    let ap=base+(pl.apBonusNext||0)-(pl.apDebtNext||0);
    if(pl.apBonusNext>0) logMsg('⚡ '+pl.name+'受击后斗志激发，本回合步数 +'+pl.apBonusNext+'（'+base+'→'+(base+pl.apBonusNext)+'）');
    if(pl.apDebtNext>0) logMsg(pl.name+'接受医疗箱治疗，本回合步数-'+pl.apDebtNext);
    pl.apBonusNext=0;pl.apDebtNext=0;
    /* 运动员疾跑：每回合重置触发标记 */
    pl.crossUsed=false;
    pl.ap=Math.max(0,ap);
  }
}

/* ====================== 回合流转 ====================== */
function endTurn(forced){
  viewFloorOverride=null;
  if(G.gameOver) return;
  const p=curPlayer();
  p.committed=false;
  logMsg(p.name+(forced?'命中逃生者，回合结束':'结束回合')+'（剩余'+p.ap+'步）');
  nextTurn();
}

function nextTurn(){
  const oldP=curPlayer();
  if(G.extraTurnIds.has(oldP.id)) G.extraTurnIds.delete(oldP.id);
  G.seqIdx++;
  if(G.seqIdx>=G.turnSequence.length){
    G.turnSequence=[...G.survIds,G.killerId];G.seqIdx=0;G.round++;
    /* 视野扩展到期检查（在 G.round 自增后判断） */
    if(G.killerVisionExpireRound>0 && G.round >= G.killerVisionExpireRound){
      G.killerVision=3;
      G.killerVisionExpireRound=0;
      logMsg('⌛ 视野扩展已到期，恢复为 3×3');
    }
    G.healBlocked=false;
    for(const pl of G.players){
      if(pl.role==='survivor'&&pl.health<=0&&pl.health>=0&&!pl.escaped){
        pl.downTimer++;
        logMsg(pl.name+'倒地中（'+pl.downTimer+'/'+DOWN_TURNS+'）');
        if(pl.downTimer>=DOWN_TURNS){pl.health=-1;pl.bloodMark=false;logMsg('💀 '+pl.name+'倒地超过'+DOWN_TURNS+'回合未获救，死亡！');}
      }
    }
    G.killerGold+=10;
    const fixers=G.players.filter(pl=>pl.fixedThisRound).map(pl=>pl.name);
    if(fixers.length) logMsg('📡 屠夫情报：上一回合修机的逃生者：'+fixers.join('、'));
    if(G.justFixedGens.length) logMsg('📡 屠夫情报：刚被修好的是 '+G.justFixedGens.join('、'));
    G.lastRoundFixers=[];G.justFixedGens=[];
    for(const pl of G.players){ pl.fixedThisRound=false;pl.committed=false;pl.actedThisTurn=false;applyTurnAp(pl); }
    logMsg('—— 第'+G.round+'回合 ——');
  } else {
    const cp=curPlayer();
    if(G.extraTurnIds.has(cp.id)){
      cp.committed=false;
      cp.actedThisTurn=false;
    }else{
      cp.committed=false;
      cp.actedThisTurn=false;
      applyTurnAp(cp);
    }
  }
  const cp=curPlayer();
  if(cp.role==='killer') G.killerPath=[{x:cp.x,y:cp.y,z:cp.floor||0}];
  /* 已淘汰 / 已逃脱 → 自动跳过（这些玩家本身无法操作，也没有「结束回合」按钮可点） */
  if(!G.gameOver&&(cp.health<0||cp.escaped)){
    logMsg(cp.name+'无法行动，自动跳过');
    nextTurn();return;
  }
  /* 需求 #1：不再因「无可用操作」自动结束回合，改由玩家在技能栏点击「结束回合」 */
  checkWin();
  if(!G.gameOver) updateAll();
}

/* ====================== 是否有可用操作（辅助判定，不再自动调用） ====================== */
function canPlayerAct(p){
  if(G.gameOver||p.committed||p.health<0||p.escaped) return false;
  if(p.ap<=0) return false;
  const z=p.floor||0;
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
    if(dx===0&&dy===0)continue;
    const tx=p.x+dx,ty=p.y+dy;
    if(tx<0||tx>=MAP_W||ty<0||ty>=MAP_H)continue;
    if(!canMoveTo(p,tx,ty)||narrowBlocked(p,tx,ty)||diagonalBlocked(p,tx,ty))continue;
    let cost=1;
    if(getTerrainAt(z,p.x,p.y)===T.STAIRS){
      const lk=stairLink3D(p.x,p.y,z);
      if(lk){
        if(!canMoveTo(p,tx,ty,lk.floor)||narrowBlocked(p,tx,ty,lk.floor)||diagonalBlocked(p,tx,ty,lk.floor))continue;
        let cost2=1;
        if(getTerrainAt(lk.floor,tx,ty)===T.WINDOW)cost2=p.role==="killer"?2:1;
        if(p.ap>=cost2)return true;
      }
    }
    if(getTerrainAt(z,tx,ty)===T.WINDOW)cost=p.role==='killer'?2:1;
    if(p.ap>=cost)return true;
  }
  if(p.role==='survivor'&&p.health>0){
    if(z===0&&p.ap>=1&&hasNearbyClosedBoard(p))return true;
    if(p.ap>=CHEST_AP&&hasNearbyClosedChest(p))return true;
    if(p.ap>=3&&downedAtSameTile(p))return true;
    if(p.ap>=3){
      const t=injuredAtSameTile(p);
      if(t&&p.items.includes('医疗箱')&&(p.charId==='doctor'||t.ap>=3))return true;
    }
    if(p.ap>=1)for(const [ex,ey,ez] of G.exits)
      if(ez===z&&adjacent(p,ex,ey)&&isDoorOpen(ex,ey,z))return true;
  }
  if(p.role==='killer'){
    if(z===0&&p.ap>=3&&hasNearbyOpenBoard(p))return true;
    if(p.ap>=3)for(const s of G.players)
      if(s.role==='survivor'&&s.health>0&&!s.escaped&&(s.floor||0)===z&&adjacent(p,s.x,s.y))return true;
    if(p.ap>=3)for(const q of G.puppets)
      if(adjacent(p,q.x,q.y)&&(q.floor||0)===z)return true;
  }
  if(!p.actedThisTurn&&p.role==='survivor'&&p.health>0){
    for(const [gx,gy,gz] of G.gens)
      if(gz===z&&adjacent(p,gx,gy)&&(G.genProgress[progressKey(z,gx,gy)]||0)<GEN_NEED)return true;
    if(G.genTotal>=GEN_TO_OPEN)
      for(const [ex,ey,ez] of G.exits)
        if(ez===z&&adjacent(p,ex,ey)&&!isDoorOpen(ex,ey,z)&&(G.exitProgress[progressKey(z,ex,ey)]||0)<DOOR_NEED)return true;
    if(isInjured(p)&&p.items.includes('注射针')&&!G.healBlocked)return true;
  }
  return false;
}

/* ====================== 行动后处理 ======================
 * 需求 #1：不再自动判定结束回合；无论玩家是否还有操作，都交由玩家手动结束。
 * 攻击逃生者命中仍由 doAttack 直接调用 endTurn(true)。
 */
function afterAction(){
  viewFloorOverride=null;
  checkWin();
  if(G.gameOver) return;
  updateAll();
}

/* ====================== 胜负 ====================== */
function checkWin(){
  if(G.gameOver) return;
  const survs=G.players.filter(p=>p.role==='survivor');
  const dead=survs.filter(p=>p.health<0).length;
  const escaped=survs.filter(p=>p.escaped).length;
  const onField=survs.length-dead-escaped;
  if(dead>1){endGame('killer','已有 '+dead+' 名逃生者死亡（超过 1 名），屠夫阵营获胜。');return;}
  if(onField===0){
    if(escaped>0) endGame('survivor','仅 '+dead+' 名逃生者死亡，其余 '+escaped+' 名全部成功撤离，逃生者阵营获胜。');
    else endGame('killer','全部逃生者均已死亡，屠夫阵营获胜。');
  }
}

function endGame(camp,reason){
  G.gameOver=true;
  G.endCamp=camp;
  G.endReason=reason;
  const kWin=camp==='killer';
  const col=kWin?'#e94560':'#4ecca3';
  const survs=G.players.filter(p=>p.role==='survivor');
  const dead=survs.filter(p=>p.health<0).length;
  const escaped=survs.filter(p=>p.escaped).length;
  const openDoors=G.exits.filter(([x,y,z])=>isDoorOpen(x,y,z)).length;
  document.getElementById('ovTitle').textContent=(kWin?'🔪 屠夫阵营获胜':'🏃 逃生者阵营获胜');
  document.getElementById('ovTitle').style.color=col;
  const rows=survs.map(pl=>{
    const ch=getChar('survivor',pl.charId);
    let fate,fcol;
    if(pl.health<0){fate='💀 死亡';fcol='#f55';}
    else if(pl.escaped){fate='🎉 已撤离';fcol='#4ecca3';}
    else{fate='仍在场（对局中止）';fcol='#aaa';}
    return '<div style="display:flex;justify-content:space-between;gap:16px;padding:5px 10px;border-bottom:1px dashed #444;">'+
      '<span><span style="color:'+pl.color+';">●</span> '+ch.icon+' '+esc(pl.name)+' <span style="color:#888;font-size:11px;">['+ch.name+']</span></span>'+
      '<b style="color:'+fcol+';">'+fate+'</b></div>';
  }).join('');
  document.getElementById('ovText').innerHTML=
    '<div style="background:'+(kWin?'rgba(233,69,96,.15)':'rgba(78,204,163,.15)')+';border:1px solid '+col+';border-radius:8px;padding:10px 12px;margin-bottom:10px;color:'+col+';">'+esc(reason)+'</div>'+
    '<div style="text-align:left;font-size:13px;">'+
      '<div style="color:#888;margin-bottom:4px;">逃生者结局</div>'+rows+
      '<div style="color:#888;margin:10px 0 4px;">对局数据</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:12px;">'+
        '<span>总回合：<b>'+G.round+'</b></span>'+
        '<span>屠夫金币：<b class="gold">'+G.killerGold+'</b></span>'+
        '<span>修好机器：<b>'+G.genTotal+'/'+GEN_TO_OPEN+'</b></span>'+
        '<span>开启大门：<b>'+openDoors+'</b></span>'+
        '<span>撤离人数：<b style="color:#4ecca3;">'+escaped+'</b></span>'+
        '<span>死亡人数：<b style="color:#f55;">'+dead+'</b></span>'+
      '</div>'+
    '</div>';
  document.getElementById('ovResume').style.display='none';
  document.getElementById('overlay').style.display='flex';
  updateAll();
  if(G.netMode&&NET&&NET.host&&!NET.frozen) hostSnapshotPush(true);
}

function closeOverlay(){document.getElementById('overlay').style.display='none';}

function restartGame(){
  document.getElementById('overlay').style.display='none';
  if(G&&G.netMode){ netRestartFlow(); return; }
  stopNetPolling();
  document.getElementById('lobby').style.display='flex';
  renderNetHome();
}

/* ====================== 日志 ====================== */
function logMsg(msg,secret){
  G.log.push({m:msg,sec:!!secret});
  if(G.log.length>60) G.log.shift();
}