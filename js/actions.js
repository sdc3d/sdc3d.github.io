/* ===================================================================
   所有行动实现（移动 / 修机 / 攻击 / 救援 / 道具 / 板窗 / 商店）
=================================================================== */

/* ====================== 移动 ====================== */
function tryMove(p,tx,ty,targetZ){
  if(G.gameOver||p.committed) return false;
  const dx=tx-p.x,dy=ty-p.y;
  if(Math.abs(dx)>1||Math.abs(dy)>1||(dx===0&&dy===0)) return false;
  /* targetZ: 在楼梯格时，玩家可选择走到不同楼层的相邻格；null/undefined 表示留在当前层 */
  const pZ=p.floor||0;
  const hasTarget=(targetZ!==undefined&&targetZ!==null);
  const useZ=hasTarget?targetZ:pZ;
  if(hasTarget&&useZ!==pZ){
    const srcTer=getTerrainAt(pZ,p.x,p.y);
    if(srcTer!==T.STAIRS){logMsg("不在楼梯上，不能跨楼层移动");return false;}
    const lk=stairLink3D(p.x,p.y,pZ);
    if(!lk||lk.floor!==useZ){logMsg("目标楼层与楼梯不连接");return false;}
  }
  if(!canMoveTo(p,tx,ty,useZ)) return false;
  if(narrowBlocked(p,tx,ty,useZ)){logMsg("窄墙阻挡！");return false;}
  if(diagonalBlocked(p,tx,ty,useZ)){logMsg("斜向移动的两条路径均被阻挡！");return false;}

  const z=useZ;
  const ter=getTerrainAt(z,tx,ty);
  const srcTer=getTerrainAt(z,p.x,p.y);
  const srcIsWin=srcTer===T.WINDOW;
  const dstIsWin=ter===T.WINDOW;
  const secret=G.extraTurnIds.has(p.id);

  let cost=1;
  let crossKind=null;
  let newSide=p.windowSide||0;

  if(p.role==="killer"){
    if(dstIsWin){
      const side=getWindowSide(z,tx,ty,p.x,p.y);
      newSide=side;
      cost=1; crossKind="window";
    } else if(srcIsWin){
      const curSide=p.windowSide||0;
      const dstSide=getWindowSide(z,p.x,p.y,tx,ty);
      if(dstSide===curSide){
        cost=1;
      } else {
        cost=2;
        logMsg("屠夫额外花1步跨过玻璃，到达窗户另一侧");
      }
      newSide=0;
      crossKind="window";
    }
  } else if(dstIsWin||srcIsWin){
    crossKind="window";
  }

  if(!dstIsWin&&!srcIsWin){
    if(z===0&&p.role==="survivor"&&G.boards.get(tx+","+ty)==="open") crossKind="board";
  }

  if(p.ap<cost){logMsg("步数不足！");return false;}
  p.ap-=cost;
  if(hasTarget&&useZ!==pZ){
    p.floor=useZ;
    logMsg(p.name+"从楼梯切换至Z="+useZ+"层",secret);
  }
  p.x=tx;p.y=ty;
  p.actedThisTurn=true;
  p.windowSide=newSide;
  logMsg(p.name+" → ("+tx+","+ty+",Z="+z+")"+(crossKind==="window"?" [翻窗]":crossKind==="board"?" [越板]":""),secret);
  if(p.role==="killer"){
    if(!G.killerPath) G.killerPath=[];
    G.killerPath.push({x:tx,y:ty,z});
  }
  /* 需求 #2：运动员疾跑，每回合至多触发一次（不再区分板/窗各一次） */
  if(p.charId==="athlete"&&crossKind&&!p.crossUsed){
    p.crossUsed=true;
    p.ap+=3;
    logMsg("🏈 [疾跑]发动！越过"+(crossKind==="window"?"窗":"板")+"，步数+3（剩余"+p.ap+"）· 本回合已触发",secret);
  }
  if(ter===T.HOLE){
    const lk=holeLink3D(tx,ty,z);
    if(lk){
      p.floor=lk.floor;
      p.x=lk.x; p.y=lk.y;
      logMsg(p.name+"从破洞坠落至("+lk.x+","+lk.y+",Z="+lk.floor+")",secret);
    }
  }
  return true;
}

/* ====================== 修机 / 修门 / 撤离 / 开箱 ====================== */
function doFixGen(p,x,y){
  if(G.gameOver||p.committed) return;
  const z=p.floor||0;
  if(p.role!=='survivor'||p.health<=0){logMsg('倒地状态无法修机');return;}
  if(G.extraTurnIds.has(p.id)){logMsg('救援小回合不可修机！');return;}
  if(p.actedThisTurn){logMsg('❌ 本回合已经进行过其他行动，无法修机（修机需消耗一整个回合）');return;}
  if(!adjacent(p,x,y)||getTerrainAt(z,x,y)!==T.GEN){logMsg('需在机器周围八格点击机器');return;}
  const key=progressKey(z,x,y);
  if((G.genProgress[key]||0)>=GEN_NEED){logMsg('该机器已修好');return;}
  p.committed=true;
  p.actedThisTurn=true;
  G.genProgress[key]=(G.genProgress[key]||0)+1;
  p.fixedThisRound=true;
  logMsg('🔧 '+p.name+'修机一回合，机器('+x+','+y+',Z='+z+')进度 '+G.genProgress[key]+'/'+GEN_NEED+'（请点击「结束回合」推进）');
  if(G.genProgress[key]>=GEN_NEED){
    G.genTotal++;
    G.justFixedGens.push('机器('+x+','+y+',Z='+z+')');
    logMsg('⚙️ 机器('+x+','+y+')修好！累计 '+G.genTotal+'/'+GEN_TO_OPEN);
    if(G.genTotal>=GEN_TO_OPEN) logMsg('已修好'+GEN_TO_OPEN+'台机器，逃生者可以开始修大门！');
  }
  afterAction();
}

function doFixExit(p,x,y){
  if(G.gameOver||p.committed) return;
  const z=p.floor||0;
  if(p.role!=='survivor'||p.health<=0){logMsg('倒地状态无法修门');return;}
  if(G.extraTurnIds.has(p.id)){logMsg('救援小回合不可修门！');return;}
  if(p.actedThisTurn){logMsg('❌ 本回合已经进行过其他行动，无法修大门');return;}
  if(G.genTotal<GEN_TO_OPEN){logMsg('需先修好'+GEN_TO_OPEN+'台机器才能修大门（当前'+G.genTotal+'）');return;}
  if(!adjacent(p,x,y)||getTerrainAt(z,x,y)!==T.EXIT){logMsg('需在大门周围八格点击大门');return;}
  const key=progressKey(z,x,y);
  if(doorProg(x,y,z)>=DOOR_NEED){logMsg('该大门已开启');return;}
  p.committed=true;
  p.actedThisTurn=true;
  G.exitProgress[key]=(G.exitProgress[key]||0)+1;
  p.fixedThisRound=true;
  logMsg('🚪 '+p.name+'修大门一回合，大门('+x+','+y+',Z='+z+')进度 '+G.exitProgress[key]+'/'+DOOR_NEED+'（请点击「结束回合」推进）');
  if(G.exitProgress[key]>=DOOR_NEED){
    G.exitOpen=true;
    G.rageRounds++;
    logMsg('大门('+x+','+y+')已开启！逃生者可在大门相邻格点击大门撤离。');
    logMsg('⚠ 屠夫将在下一回合进入持续1回合的【狂暴】！');
  }
  afterAction();
}

function doEscapeDoor(p,x,y){
  if(G.gameOver||p.committed) return;
  const z=p.floor||0;
  if(p.role!=='survivor'||p.health<=0){logMsg('倒地状态无法撤离');return;}
  if(getTerrainAt(z,x,y)!==T.EXIT){logMsg('目标不是大门');return;}
  if(!isDoorOpen(x,y,z)){logMsg('大门尚未开启');return;}
  if(!adjacent(p,x,y)){logMsg('需在大门周围八格点击大门');return;}
  if(p.ap<1){logMsg('撤离需消耗1步');return;}
  p.ap-=1;
  p.committed=true;p.escaped=true;p.bloodMark=false;
  logMsg('🎉 '+p.name+'从大门('+x+','+y+',Z='+z+')成功撤离！');
  afterAction();
}

function doOpenChest(p,x,y){
  if(G.gameOver||p.committed) return;
  const z=p.floor||0;
  if(G.extraTurnIds.has(p.id)){logMsg('救援小回合不可开箱');return;}
  if(p.role!=='survivor'||p.health<=0){logMsg('倒地状态无法开箱');return;}
  if(getTerrainAt(z,x,y)!==T.CHEST){logMsg('目标不是箱子');return;}
  if(!adjacent(p,x,y)){logMsg('需在箱子周围八格点击箱子');return;}
  const key=progressKey(z,x,y);
  if(G.chestsOpened.has(key)){logMsg('该箱子已开启');return;}
  if(p.ap<CHEST_AP){logMsg('开箱需消耗'+CHEST_AP+'步（剩余'+p.ap+'）');return;}
  p.ap-=CHEST_AP;
  p.actedThisTurn=true;
  G.chestsOpened.add(key);
  const item=G.chestItems.get(key)||(Math.random()<0.5?'注射针':'医疗箱');
  p.items.push(item);
  logMsg(p.name+'消耗'+CHEST_AP+'步打开箱子('+x+','+y+',Z='+z+')，获得['+item+']！');
  afterAction();
}

function doEscape(p){
  if(G.gameOver) return;
  afterAction();
}

/* ====================== 攻击 ======================
 * 命中逃生者后：
 *   · 屠夫下一回合步数 -3   → G.killerApDebt = 3
 *   · 被刀逃生者下一回合 +3 → target.apBonusNext = 3（若未倒地）
 *   · 屠夫回合立即结束（endTurn(true)）
 */
function doAttack(p,target){
  if(G.gameOver||p.committed) return;
  if(p.role!=='killer'||target.role!=='survivor') return;
  if((p.floor||0)!==(target.floor||0)) return;
  const dx=Math.abs(target.x-p.x),dy=Math.abs(target.y-p.y);
  if(dx>1||dy>1||(dx===0&&dy===0)){logMsg('目标不在攻击范围');return;}
  if(target.health<=0){logMsg('目标已倒地，无法攻击');return;}
  if(p.ap<3){logMsg('攻击需消耗3步（剩余'+p.ap+'步）');return;}
  p.ap-=3;
  p.actedThisTurn=true;
  let dmg=1+(G.rageActive?1:0);
  if(p.charId==='servant'&&G.servantBoost&&(p.contracts||0)>0){
    p.contracts--;dmg+=0.5;
    logMsg(p.name+'消耗1层[生命之契]，本次普攻伤害+0.5！（剩余'+p.contracts+'层）');
  }
  target.health=Math.round((target.health-dmg)*2)/2;
  G.killerGold+=50;
  logMsg(p.name+'击中'+target.name+'！造成'+dmg+'点伤害（+50金币）');
  if(target.health<=0){
    target.health=0;target.downTimer=0;target.committed=false;target.bloodMark=false;
    target.downCount++;
    if(target.downCount>MAX_DOWN){
      target.health=-1;
      logMsg('💀 '+target.name+'第'+target.downCount+'次进入倒地，直接死亡！');
    }else{
      logMsg(target.name+'倒地！（第'+target.downCount+'/'+MAX_DOWN+'次，2回合内未被救起将死亡）');
    }
  } else {
    target.apBonusNext=3;
    logMsg('⚡ '+target.name+'受伤！剩余血量 '+fmtHp(target.health)+'/'+target.maxHp+'，下回合步数 +3');
  }
  G.killerApDebt=3;
  logMsg('🩸 屠夫因命中动作消耗，下回合步数 -3');
  endTurn(true);   /* 命中真人 → 屠夫回合立即结束 */
}

function doAttackPuppet(p,q){
  if(G.gameOver||p.committed) return;
  if(p.role!=='killer') return;
  if(!adjacent(p,q.x,q.y)){logMsg('木偶不在攻击范围');return;}
  if((p.floor||0)!==(q.floor||0)){logMsg('木偶不在同一层');return;}
  if(p.ap<3){logMsg('攻击需消耗3步');return;}
  p.ap-=3;
  p.actedThisTurn=true;
  G.puppets.splice(G.puppets.indexOf(q),1);
  logMsg(p.name+'挥击目标——竟是一个木偶！木偶被击碎消散。');
  afterAction();   /* 攻击木偶不结束回合，屠夫可继续行动 */
}

/* ====================== 仆人技能 ====================== */
function doServantMark(p){
  if(G.gameOver)return;
  p=p||curPlayer();
  if(p.charId!=='servant'||p.role!=='killer'){logMsg('仅仆人可使用');return;}
  if((G.servantUsedCount||0)>=2){logMsg("[万相化灰]本局已用完2次");return;}
  let n=0;
  for(const s of G.players){
    if(s.role!=='survivor'||s.escaped||s.health<=0)continue;
    if((s.floor||0)!==(p.floor||0))continue;
    if(Math.abs(s.x-p.x)<=3&&Math.abs(s.y-p.y)<=3){s.bloodMark=true;n++;}
  }
  if(!n){logMsg('7×7范围内没有可标记的逃生者，[万相化灰]未生效');return;}
  G.servantUsedCount=(G.servantUsedCount||0)+1;
  logMsg('🕯️ [万相化灰]发动！以'+p.name+'为中心的7×7范围内 '+n+' 名逃生者被附加[血偿勒令]！');
  afterAction();
}
function doRecallMarks(p){
  if(G.gameOver)return;
  p=p||curPlayer();
  if(p.charId!=='servant'||p.role!=='killer'){logMsg('仅仆人可回收');return;}
  let n=0;
  for(const s of G.players){
    if(s.role==='survivor'&&s.bloodMark){s.bloodMark=false;n++;}
  }
  if(!n){logMsg('当前没有可回收的[血偿勒令]');return;}
  p.contracts=(p.contracts||0)+n;
  logMsg('🕯️ 仆人回收 '+n+' 道[血偿勒令]，获得 '+n+' 层[生命之契]（当前共 '+p.contracts+' 层）');
  afterAction();
}
function toggleServantBoost(){
  G.servantBoost=!G.servantBoost;
  logMsg('生命之契增幅已'+(G.servantBoost?'开启（普攻自动消耗1层，伤害+0.5）':'关闭'));
  updateAll();
}

/* ====================== 救援 / 道具 ====================== */
function doRescue(p,target){
  if(G.gameOver||p.committed) return;
  if(p.role!=='survivor'||p.health<=0) return;
  target=target||downedAtSameTile(p);
  if(!target){logMsg('同格没有倒地队友（需走到倒地者所在格）');return;}
  if(target.health!==0){logMsg('目标未倒地');return;}
  if(target.x!==p.x||target.y!==p.y||(target.floor||0)!==(p.floor||0)){logMsg('需与倒地队友处于同一格');return;}
  if(p.ap<3){logMsg('救援需消耗自己3步（剩余'+p.ap+'）');return;}
  p.ap-=3;
  p.actedThisTurn=true;
  target.health=1;target.downTimer=0;
  logMsg(p.name+'在同格救起'+target.name+'，消耗3步。');
  if(G.extraTurnIds.has(target.id)) return;
  G.extraTurnIds.add(target.id);
  const idx=G.seqIdx;
  G.turnSequence.splice(idx+1,0,target.id);
  target.ap=RESCUE_AP;
  target.committed=false;
  target.actedThisTurn=false;
  logMsg('🤫 '+target.name+'进入独立小回合：可独自行动'+RESCUE_AP+'步（仅逃生者阵营可见，不可修机/修门）');
  afterAction();
}

function doInject(p){
  if(G.gameOver||p.committed) return;
  if(G.healBlocked){logMsg('禁疗诅咒生效中！');return;}
  if(p.role!=='survivor'||p.health<=0){logMsg('倒地状态无法使用注射针（需队友救援）');return;}
  if(!isInjured(p)){logMsg('当前血量已满');return;}
  const i=p.items.indexOf('注射针');
  if(i<0){logMsg('没有注射针');return;}
  p.committed=true;
  p.actedThisTurn=true;
  p.items.splice(i,1);
  p.health=Math.min(p.maxHp,p.health+1);
  logMsg('💉 '+p.name+'使用注射针，回复1点血量（'+fmtHp(p.health)+'/'+p.maxHp+'），消耗整回合（请点击「结束回合」推进）');
  afterAction();
}

function doMedkit(p,target){
  if(G.gameOver||p.committed) return;
  if(G.healBlocked){logMsg('禁疗诅咒生效中！');return;}
  if(p.role!=='survivor'||p.health<=0) return;
  target=target||injuredAtSameTile(p);
  if(!target){logMsg('同格没有受伤队友');return;}
  if(target.x!==p.x||target.y!==p.y||(target.floor||0)!==(p.floor||0)){logMsg('需与受伤队友处于同一格');return;}
  const i=p.items.indexOf('医疗箱');
  if(i<0){logMsg('没有医疗箱');return;}
  if(p.ap<3){logMsg('治疗需消耗自己3步');return;}
  const doctor=p.charId==='doctor';
  if(!doctor&&target.ap<3){logMsg(target.name+'剩余步数不足3，无法承担治疗消耗');return;}
  p.ap-=3;
  p.actedThisTurn=true;
  p.items.splice(i,1);
  target.health=Math.min(target.maxHp,target.health+1);
  if(doctor){
    logMsg('💉 医生使用医疗箱治疗同格的'+target.name+'：[治疗]生效，仅消耗医生3步，'+target.name+'回复1血（'+fmtHp(target.health)+'/'+target.maxHp+'）');
  }else{
    target.ap-=3;
    logMsg('🧰 '+p.name+'使用医疗箱治疗同格的'+target.name+'，两人各耗3步，'+target.name+'回复1血（'+fmtHp(target.health)+'/'+target.maxHp+'）');
  }
  afterAction();
}

/* ====================== 魔术师木偶 ====================== */
function doPlacePuppet(p){
  if(G.gameOver||p.committed) return;
  if(G.extraTurnIds.has(p.id)){logMsg('救援小回合仅可移动/救援');return;}
  if(p.charId!=='magician'||p.role!=='survivor'){logMsg('仅魔术师可放木偶');return;}
  if((p.puppets||0)<=0){logMsg('木偶已用完');return;}
  if(puppetAt(p.x,p.y,p.floor||0)){logMsg('此处已有木偶');return;}
  p.puppets--;
  p.actedThisTurn=true;
  G.puppets.push({x:p.x,y:p.y,floor:p.floor||0,owner:p.id});
  logMsg('🪄 '+p.name+'在('+p.x+','+p.y+',Z='+(p.floor||0)+')放下一个木偶（剩余'+p.puppets+'个），屠夫将无法区分。');
  afterAction();
}

/* ====================== 板子 ====================== */
function doPutBoard(p){
  if(G.gameOver||p.committed) return;
  if(G.extraTurnIds.has(p.id)){logMsg('救援小回合仅可移动/救援');return;}
  if(p.role!=='survivor'){logMsg('仅逃生者可开板');return;}
  if((p.floor||0)!==0){logMsg('板子只在地面层');return;}
  const spots=[];
  for(const [key,st] of G.boards){
    if(st!=='closed') continue;
    const [bx,by]=key.split(',').map(Number);
    if(Math.abs(bx-p.x)<=1&&Math.abs(by-p.y)<=1&&(Math.abs(bx-p.x)!==0||Math.abs(by-p.y)!==0)) spots.push([bx,by,key]);
  }
  if(!spots.length){logMsg('附近无可开启的板子');return;}
  if(p.ap<1){logMsg('开板需1步');return;}
  p.ap-=1;
  p.actedThisTurn=true;
  const [bx,by,key]=spots[0];
  G.boards.set(key,'open');
  logMsg(p.name+'在('+bx+','+by+')放下板子（打开状态），可阻挡屠夫');
  afterAction();
}

function doBreakBoard(p){
  if(G.gameOver||p.committed) return;
  if(p.role!=='killer'){logMsg('仅屠夫可破坏板子');return;}
  if((p.floor||0)!==0){logMsg('板子只在地面层');return;}
  const targets=[];
  for(const [key,st] of G.boards){
    if(st!=='open') continue;
    const [bx,by]=key.split(',').map(Number);
    if(Math.abs(bx-p.x)<=1&&Math.abs(by-p.y)<=1&&(Math.abs(bx-p.x)!==0||Math.abs(by-p.y)!==0)) targets.push([bx,by,key]);
  }
  if(!targets.length){logMsg('周围8格内无已打开的板子');return;}
  if(p.ap<3){logMsg('破坏板子需3步');return;}
  p.ap-=3;G.killerGold+=10;
  p.actedThisTurn=true;
  const [bx,by,key]=targets[0];
  G.boards.delete(key);
  logMsg(p.name+'破坏('+bx+','+by+')的板子！耗3步，+10金币');
  afterAction();
}

/* ====================== 屠夫商店 ====================== */
function buyItem(item){
  const p=curPlayer();
  if(p.role!=='killer'){logMsg('仅屠夫可购买');return;}

  if(item.id==='teleport' && G.teleportBought){
    logMsg('❌ 本局已购买过瞬移，无法再次购买');
    return;
  }
  if(item.id==='vision' && G.killerVisionExpireRound>G.round){
    logMsg('❌ 视野扩展正在生效中（第'+G.killerVisionExpireRound+'回合结束前）');
    return;
  }
  if(G.killerGold<item.cost){logMsg('金币不足');return;}
  G.killerGold-=item.cost;

  if(item.id==='vision'){
    G.killerVision=5;
    G.killerVisionExpireRound = G.round + 3;
    logMsg('🔭 视野扩展至 5×5，持续 3 回合（第'+G.round+'~'+(G.killerVisionExpireRound-1)+'回合）');
  }
  else if(item.id==='ap'){p.ap+=3;logMsg('本回合+3行动点');}
  else if(item.id==='teleport'){
    G.teleportBought=true;
    const kZ=p.floor||0;
    const g=G.gens.filter(([x,y,zz])=>zz===kZ&&(G.genProgress[progressKey(kZ,x,y)]||0)<GEN_NEED);
    if(g.length){
      const [gx,gy]=g[Math.floor(Math.random()*g.length)];
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){
        const nx=gx+dx,ny=gy+dy;
        if(nx<0||nx>=MAP_W||ny<0||ny>=MAP_H) continue;
        if(isBlockedTerrain(getTerrainAt(kZ,nx,ny))) continue;
        if(getPlayerAt(nx,ny)) continue;
        p.x=nx;p.y=ny;logMsg('屠夫瞬移至电机旁('+nx+','+ny+',Z='+kZ+')');break;
      }
    }
    logMsg('🌀 本局瞬移已使用（不可再购）');
  }
  else if(item.id==='healblock'){G.healBlocked=true;logMsg('禁疗诅咒生效！本回合逃生者无法治疗');}
  updateAll();
}