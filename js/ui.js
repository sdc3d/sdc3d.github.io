/* ===================================================================
   UI 更新（侧栏、按钮、楼层选择器）
=================================================================== */
function getEffectiveViewFloor(){
  if(viewFloorOverride!=null && G && G.mapsByZ && G.mapsByZ.has(viewFloorOverride)) return viewFloorOverride;
  const {obs}=viewCtx();
  return obs.floor||0;
}

function onFloorViewChange(v){
  if(v==="auto"){viewFloorOverride=null;}
  else{viewFloorOverride=parseInt(v)||0;}
  if(G) updateAll();
}

function updateFloorViewSel(){
  const sel=document.getElementById("floorViewSel");
  if(!sel||!G) return;
  const {obs}=viewCtx();
  const curZ=obs.floor||0;
  const ter=getTerrainAt(curZ,obs.x,obs.y);
  let opts="<option value=\"auto\">自动（当前层 Z="+curZ+"）</option>";
  if(ter===T.STAIRS){
    const lk=stairLink3D(obs.x,obs.y,curZ);
    if(lk){
      const otherZ=lk.floor;
      if(viewFloorOverride===null||viewFloorOverride===curZ){
        opts+="<option value=\""+curZ+"\">Z="+curZ+"（当前层）</option>";
        opts+="<option value=\""+otherZ+"\">Z="+otherZ+"（楼梯连接层）</option>";
      }else{
        opts+="<option value=\""+otherZ+"\">Z="+otherZ+"（楼梯连接层）</option>";
        opts+="<option value=\""+curZ+"\">Z="+curZ+"（当前层）</option>";
      }
    }
  }else{
    const zs=getExistingFloors();
    for(const z of zs){
      if(z===curZ) continue;
      opts+="<option value=\""+z+"\">Z="+z+"（观察）</option>";
    }
  }
  sel.innerHTML=opts;
  if(viewFloorOverride===null) sel.value="auto";
  else sel.value=String(viewFloorOverride);
}

function updateAll(){render();updateUI();}

/* ====================== 按钮工具 ====================== */
function actBtn(label,cls,name,arg){
  const a=arg===undefined?'':(','+JSON.stringify(arg));
  return '<button class="btn '+cls+'" onclick="'+(G.netMode?'netDo':'doAct')+"('"+name+"'"+a+')">'+label+'</button>';
}
function runBtn(name,arg,p){
  switch(name){
    case 'putBoard':doPutBoard(p);break;
    case 'inject':doInject(p);break;
    case 'medkit':doMedkit(p);break;
    case 'rescue':doRescue(p);break;
    case 'puppet':doPlacePuppet(p);break;
    case 'breakBoard':doBreakBoard(p);break;
    case 'servantMark':doServantMark(p);break;
    case 'recallMarks':doRecallMarks(p);break;
    case 'boost':toggleServantBoost();break;
    case 'buy':buyItem(arg);break;
    case 'end':endTurn(false);break;
  }
}
function doAct(name,arg){ runBtn(name,arg,curPlayer()); }
function netDo(name,arg){
  if(!G||!G.netMode||G.gameOver)return;
  if(NET.frozen)return;
  const me=G.players[NET.slot];
  if(curPlayer().id!==me.id){netToast('还没轮到你行动，请等待你的回合');return;}
  if(NET.host){ runBtn(name,arg,me); net.dirty=true; return; }
  if(net.pending){netToast('上一步操作正在同步，请稍候…');return;}
  netSendIntent({type:'button',name,item:name==='buy'?arg:undefined});
}
function execIntent(a){
  const p=G.players[a.slot];
  if(!p)return;
  if(a.type==='click'){clickAt(p,a.x,a.y,a.targetFloor);return;}
  if(a.type==='end'){endTurn(false);return;}
  if(a.type==='button')runBtn(a.name,a.item,p);
}

/* ====================== 技能栏（含结束回合按钮） ======================
 * 需求 #1：不再自动结束回合 → 提供显式「结束回合」按钮
 * 需求 #2：仆人专属技能按钮也在此栏内
 */
function renderSkillPanel(focus, online, myTurn){
  const el=document.getElementById('skills');
  if(!el) return;
  const fch=getChar(focus.role, focus.charId);
  const go=G.netMode?'netDo':'doAct';
  const dis=(online&&!myTurn)?'disabled':'';
  let html='';

  /* ---- 结束回合按钮（任何时刻都显示；非自己回合时禁用） ---- */
  if(!G.gameOver){
    const canEnd = myTurn && !focus.escaped && focus.health>=0;
    const endDis = canEnd ? '' : 'disabled';
    const endCls = canEnd ? '' : 'gray';
    html += '<button class="btn '+endCls+'" style="width:100%;margin:3px 0 8px;padding:8px 8px;font-size:13px;" '
         + endDis + ' onclick="' + (G.netMode?'netDo':'doAct') + "('end')" + '">⏭ 结束回合</button>';
  }

  /* ---- 角色专属技能 ---- */
  if(focus.role==='killer' && focus.charId==='servant'){
    const used=G.servantUsedCount||0;
    if(used<2){
      html+='<button class="btn" style="background:#7a3aa0;width:100%;margin:3px 0;padding:7px 8px;" '+dis
        +' onclick="'+go+"('servantMark')"+'">🕯️ 万相化灰（本局剩 '+(2-used)+' 次）</button>';
    }else{
      html+='<button class="btn gray" style="width:100%;margin:3px 0;padding:7px 8px;" disabled>🕯️ 万相化灰（本局已用完）</button>';
    }
    const marked=G.players.filter(pl=>pl.role==='survivor'&&pl.bloodMark).length;
    if(marked>0){
      html+='<button class="btn" style="background:#8a6a20;width:100%;margin:3px 0;padding:7px 8px;" '+dis
        +' onclick="'+go+"('recallMarks')"+'">♻️ 回收勒令（'+marked+'）→ 生命之契</button>';
    }else{
      html+='<div style="color:#888;font-size:11px;margin:3px 0;">♻️ 当前无可回收的[血偿勒令]</div>';
    }
    html+='<button class="btn '+(G.servantBoost?'':'gray')+'" style="width:100%;margin:3px 0;padding:7px 8px;" '+dis
      +' onclick="'+go+"('boost')"+'">⚔️ 普攻增幅：'+(G.servantBoost?'开启':'关闭')+'</button>';
    html+='<div class="hint">开启时普攻自动消耗 1 层[生命之契]，本次伤害 +0.5</div>';
    const contracts=focus.contracts||0;
    html+='<div style="margin-top:6px;font-size:12px;line-height:1.6;">'+
      '<span style="color:#b060ff;">🕯️ [血偿勒令]标记：'+marked+' 人</span><br>'+
      '<span style="color:#c8a850;">[生命之契]：'+contracts+' 层</span></div>';
  }else{
    html+='<div style="font-size:12px;color:#cde;line-height:1.55;">'+
      fch.skills.map(sk=>'<div style="margin-bottom:4px;"><b style="color:#f97;">'+esc(sk.n)+'</b><br>'+
        '<span style="color:#aaa;font-size:11px;">'+esc(sk.d)+'</span></div>').join('')+
      '</div><div class="hint">该角色暂无主动技能按钮</div>';
  }
  el.innerHTML=html;
}

/* ====================== 商店面板 ====================== */
function renderShop(focus, online, myTurn){
  const sk=document.getElementById('shop');
  document.getElementById('goldDisp').textContent='💰'+G.killerGold;
  if(focus.role!=='killer'){
    sk.innerHTML='<span style="color:#888;font-size:11px;">商店为屠夫专属</span>';
    return;
  }
  const go=G.netMode?'netDo':'doAct';
  sk.innerHTML=G.shopItems.map(it=>{
    let active=false, label=it.cost+'💰';
    if(it.id==='vision'){
      if(G.killerVisionExpireRound>G.round){
        active=true;
        const remain=G.killerVisionExpireRound-G.round;
        label='生效中（剩'+remain+'回合）';
      }
    }else if(it.id==='teleport'){
      if(G.teleportBought){
        active=true;
        label='本局已购';
      }
    }
    const dis=active||G.killerGold<it.cost||(online&&!myTurn);
    return '<div class="shopItem"><span>'+it.name+
        '<br><span style="color:#888;font-size:10px;">'+it.desc+'</span></span>'+
      '<button class="btn" '+((dis)?'disabled':'')+' onclick="'+go+"('buy',"+JSON.stringify(it)+')">'+label+'</button></div>';
  }).join('');
}

/* ====================== 主 UI 更新 ====================== */
function updateUI(){
  updateFloorViewSel();
  const p=curPlayer();
  const online=!!G.netMode;
  const me=online?G.players[NET.slot]:p;
  const myTurn=online?p.id===me.id:true;
  const focus=me;
  const pch=getChar(p.role,p.charId);
  const fch=getChar(focus.role,focus.charId);
  const ti=document.getElementById('turnInfo');
  const inMiniP=G.extraTurnIds.has(p.id);
  const fMini=G.extraTurnIds.has(focus.id);
  const apDen=focus.role==='killer'?(focus.maxAp+(G.rageActive?3:0)):(fMini?RESCUE_AP:(focus.health<=0?3:focus.maxAp));
  const floorLabel=focus.floor===0?'地面':(focus.floor<0?'地下室 Z='+focus.floor:'Z='+focus.floor+' 楼');
  let head='<div style="color:'+(p.role==='killer'?'#e94560':'#4ecca3')+';font-size:17px;">'+esc(p.name)+'<span style="font-size:12px;font-weight:normal;"> ['+(p.role==='killer'?'🔪屠夫':'🏃逃生者')+'·'+pch.name+']</span>'+
    (inMiniP?' <span style="color:#fa0">[救援小回合·仅逃生者可见]</span>':'')+(G.rageActive?' <span style="color:#f55;">💢狂暴(步+3/伤+1)</span>':'')+'</div>'+
    '<div style="font-size:12px;color:#aaa;">第'+G.round+'回合 · '+floorLabel+'</div>';
  if(online) head+='<div style="margin-top:3px;font-size:13px;font-weight:bold;color:'+(myTurn?'#4ecca3':'#fa0')+';">'+(myTurn?'👉 轮到你行动了':'⏳ 等待 '+esc(p.name)+' 行动…')+'</div>';
  head+='<div class="apBar"><div class="apFill" style="width:'+Math.min(100,focus.ap/apDen*100)+'%;"></div><span>'+focus.ap+'/'+apDen+' 步</span></div>';
  ti.innerHTML=head;

  /* ---------- 角色信息 ---------- */
  const pi=document.getElementById('playerInfo');
  let s='<b>'+esc(focus.name)+'</b> ('+(focus.role==='killer'?'屠夫':'逃生者')+')'+
    '<br>角色：'+fch.icon+' <b>'+fch.name+'</b> <span style="color:#777;font-size:11px;">［'+fch.tag+'］</span>';
  s+='<br>坐标 (X,Y,Z): ('+focus.x+','+focus.y+','+(focus.floor||0)+') '+floorLabel+' | 步数: '+focus.ap+'/'+apDen;
  if(focus.role==='survivor'){
    const [hs,hc]=hpStateText(focus);
    s+='<br>健康: <b style="color:'+hc+'">'+hs+'</b>（血量 '+fmtHp(Math.max(0,focus.health))+'/'+focus.maxHp+'）';
    if(focus.health===0) s+='<br><span style="color:#f55;">倒地爬行：本回合仅3步 · 倒地计时 '+focus.downTimer+'/'+DOWN_TURNS+' · 第'+focus.downCount+'/'+MAX_DOWN+'次倒地</span>';
    s+='<br>道具: '+(focus.items.length?focus.items.join('、'):'无');
    if(focus.charId==='magician') s+='<br>🪆 木偶剩余: '+(focus.puppets||0)+' 个';
    if(focus.charId==='athlete') s+='<br>🏈 疾跑：'+(focus.crossUsed?'本回合已触发':'本回合可用（越板/窗 +3步）');
    if(focus.apBonusNext>0) s+='<br><span style="color:#4ecca3;">⚡ 下回合步数+'+focus.apBonusNext+'（受击）</span>';
    if(focus.apDebtNext>0) s+='<br><span style="color:#fa0;">下回合步数-'+focus.apDebtNext+'（治疗消耗）</span>';
  }else{
    s+='<br>金币: <span class="gold">'+G.killerGold+'</span> | 视野: '+G.killerVision+'×'+G.killerVision;
    if(G.killerVisionExpireRound>G.round){
      s+=' <span style="color:#9cf;">（剩'+(G.killerVisionExpireRound-G.round)+'回合）</span>';
    }
    if(G.killerApDebt>0) s+='<br><span style="color:#f55;">🩸 下回合步数-'+G.killerApDebt+'（上回合命中）</span>';
    if(G.teleportBought) s+='<br><span style="color:#888;">🌀 瞬移：本局已使用</span>';
  }
  const ft=getTerrainAt(focus.floor||0,focus.x,focus.y);
  s+='<br>地形: '+TN[ft];
  if(myTurn&&focus.committed) s+='<br><b style="color:#f00">已投入整回合操作</b>';
  if(myTurn&&focus.role==='survivor'&&focus.actedThisTurn&&!focus.committed) s+='<br><span style="color:#fa0;">本回合已行动 → 无法修机/修门</span>';
  pi.innerHTML=s;

  /* ---------- 技能栏（含结束回合按钮） ---------- */
  renderSkillPanel(focus, online, myTurn);

  /* ---------- 商店 ---------- */
  renderShop(focus, online, myTurn);

  /* ---------- 操作栏 ---------- */
  const ac=document.getElementById('actions');
  let btns='';
  if(!G.gameOver){
    if(online&&!myTurn){
      btns+='<div style="color:#fa0;font-size:13px;padding:6px 2px;">⏳ 当前是 '+esc(p.name)+' 的回合，请在自己的设备上等待…</div>';
    }else if(!focus.committed){
      if(focus.role==='survivor'){
        if(focus.health>0){
          if((focus.floor||0)===0&&focus.ap>=1&&hasNearbyClosedBoard(focus)) btns+=actBtn('开板(1步)','green','putBoard');
          if(isInjured(focus)&&focus.items.includes('注射针')&&!G.healBlocked) btns+=actBtn('注射针自疗(整回合)','blue','inject');
          const tInj=injuredAtSameTile(focus);
          if(tInj&&focus.items.includes('医疗箱')&&focus.ap>=3&&(focus.charId==='doctor'||tInj.ap>=3)&&!G.healBlocked)
            btns+=actBtn('医疗箱治'+esc(tInj.name)+'(3步)','blue','medkit');
          if(downedAtSameTile(focus)&&focus.ap>=3)
            btns+=actBtn('救援同格队友(3步→7步小回合)','','rescue');
          if(focus.charId==='magician'&&(focus.puppets||0)>0)
            btns+=actBtn('放木偶(剩'+focus.puppets+')','','puppet');
          if(hasNearbyClosedChest(focus)&&focus.ap<CHEST_AP)
            btns+='<div style="color:#888;font-size:11px;padding:4px;">🪵 附近有箱子，需 '+CHEST_AP+' 步才能打开（当前步数不足）</div>';
        }else{
          btns+='<span style="color:#f55;font-size:12px;">倒地中：只能爬行（3步），等待队友走到同格救援</span>';
        }
      }else{
        if((focus.floor||0)===0&&focus.ap>=3&&hasNearbyOpenBoard(focus)) btns+=actBtn('破板(3步,+10💰)','','breakBoard');
        if(!btns) btns+='<span style="color:#888;font-size:11px;">当前无可用的通用操作，点击相邻格进行移动/攻击</span>';
      }
    }else{
      btns+='<div style="color:#fa0;font-size:13px;padding:6px 2px;">✅ 已完成整回合操作，请点击「技能」栏顶部「⏭ 结束回合」按钮进入下一位玩家</div>';
    }
    if(online&&net.pending) btns+='<div class="netPending">📶 操作已发送，等待房主设备同步快照…</div>';
  }
  ac.innerHTML=btns+'<div class="hint">点击周围八格：移动；屠夫点逃生者/木偶=攻击(3步)<br>逃生者点相邻的机器/大门=修(整回合)；点相邻箱子=开箱('+CHEST_AP+'步)<br>大门开启后点相邻大门=撤离；按钮会随剩余步数智能显隐<br>⏭ 使用「结束回合」按钮进入下一位玩家</div>';

  const mask=document.getElementById('netWaitMask');
  if(mask){
    if(online&&!G.gameOver&&!myTurn){mask.style.display='flex';document.getElementById('netWaitText').innerHTML='⏳ 等待 <b>'+esc(p.name)+'</b> 行动';}
    else mask.style.display='none';
  }

  /* ---------- 战况 ---------- */
  const st=document.getElementById('status');
  const survs=G.players.filter(pl=>pl.role==='survivor');
  const escCnt=survs.filter(pl=>pl.escaped).length;
  const deadCnt=survs.filter(pl=>pl.health<0).length;

  const kZ = focus.floor||0;
  const doors=G.exits.map(([x,y,z])=>{
    if(focus.role==='killer' && z!==kZ && !killerCanSeeFloorFromStairs(kZ, z)){
      return '门('+x+','+y+',Z'+z+'):<span style="color:#666">?</span>';
    }
    return '门('+x+','+y+',Z'+z+'):'+(isDoorOpen(x,y,z)?'<b style="color:#0f0">开</b>':(G.genTotal>=GEN_TO_OPEN?doorProg(x,y,z)+'/'+DOOR_NEED:'锁'));
  }).join(' | ');

  let survLines;
  if(focus.role==='killer'){
    survLines=survs.map(pl=>{
      const head2='<span style="color:'+pl.color+'">●</span>'+getChar('survivor',pl.charId).icon+esc(pl.name)+': ';
      if(pl.health<0) return head2+'<span style="color:#f55">💀 死亡</span>';
      if(pl.escaped) return head2+'<span style="color:#4ecca3">🎉 已撤离</span>';
      const pZ = pl.floor||0;
      if(pZ !== kZ && !killerCanSeeFloorFromStairs(kZ, pZ)){
        return head2+'<span style="color:#777">位置未知</span>';
      }
      if(pZ !== kZ){
        if(isVisible(pl.x,pl.y,focus)) return head2+'<span style="color:#9cf">在 Z='+pZ+' 层</span> '+hpStateText(pl)[0];
        return head2+'<span style="color:#777">位置未知</span>';
      }
      if(isVisible(pl.x,pl.y,focus)) return head2+hpStateText(pl)[0]+(isInjured(pl)?' '+fmtHp(pl.health)+'/'+pl.maxHp:'')+(pl.health===0?' (倒地'+pl.downCount+')':'');
      return head2+'<span style="color:#777">视野外 · 位置未知</span>';
    }).join('<br>');
  }else{
    survLines=survs.map(pl=>'<span style="color:'+pl.color+'">●</span>'+getChar('survivor',pl.charId).icon+esc(pl.name)+' (Z='+(pl.floor||0)+'): '+hpStateText(pl)[0]+
      (pl.bloodMark?' <span style="color:#b060ff;">[令]</span>':'')+
      (isInjured(pl)?' '+fmtHp(pl.health)+'/'+pl.maxHp:'')+
      (pl.health===0?' (倒地'+pl.downCount+'/'+MAX_DOWN+')':'')).join('<br>');
  }
  st.innerHTML='机器修好: <b>'+G.genTotal+'/'+GEN_TO_OPEN+'</b>（每台需'+GEN_NEED+'点）<br>'+doors+
    '<br>逃脱: <b style="color:#0f0">'+escCnt+'</b> | 淘汰: <b style="color:#f00">'+deadCnt+'</b><br>'+survLines;

  const lg=document.getElementById('log');
  const logs=G.log.slice(-30).reverse().filter(m=>!(focus.role==='killer'&&m.sec));
  lg.innerHTML=logs.map(m=>'<div>'+esc(m.m)+'</div>').join('');
}