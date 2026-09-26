/* ===================================================================
   在线联机
=================================================================== */
const net={
  code:null,pid:null,state:null,phase:'',pollTimer:null,tickTimer:null,
  clockOffset:0,selected:null,sentPick:null,pickSending:false,
  busy:false, hid:null, hostAid:0, gseq:0, pending:false, dirty:false,
  lastPush:0, serverUrl:'',
};

function getServerUrl(){
  return net.serverUrl||sessionStorage.getItem('net-server-url')||'';
}
function setServerUrl(url){
  url=(url||'').trim().replace(/\/+$/,'');
  net.serverUrl=url;
  sessionStorage.setItem('net-server-url',url);
}

async function api(p,body){
  const base=getServerUrl();
  const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  let j=null; try{j=await r.json();}catch(e){}
  if(!r.ok||!j||j.ok===false) throw new Error((j&&j.error)||('HTTP '+r.status));
  return j;
}
async function apiGet(p){
  const base=getServerUrl();
  const r=await fetch(base+p,{cache:'no-store'});
  const j=await r.json().catch(()=>null);
  if(!r.ok||!j||j.ok===false) throw new Error((j&&j.error)||('HTTP '+r.status));
  return j;
}
function netErr(msg,el){
  const box=el||$('netErr');
  if(box){box.textContent=msg||'';box.style.display=msg?'block':'none';}
}

/* ====================== 首页 ====================== */
function renderNetHome(){
  netErr('',null);
  const saved=net.code&&net.pid;
  const savedUrl=getServerUrl();
  $('netFlow').innerHTML=
    '<h2 style="color:#4ecca3;font-size:20px;">🌐 在线联机</h2>'+
    '<div class="netErr" id="netErr"></div>'+
    '<div style="margin:14px 0;text-align:left;max-width:460px;margin-left:auto;margin-right:auto;">'+
      '<label style="font-size:12px;color:#aaa;">服务器地址（房主启动 server.js 后分享的地址，如 http://xxx:8787）</label><br>'+
      '<input class="netInput" id="nhServerUrl" placeholder="http://例如:8787" value="'+esc(savedUrl)+'" style="width:100%;margin-top:4px;">'+
    '</div>'+
    '<div class="netRow" style="margin-top:14px;">'+
      '<div style="width:200px;"><input class="netInput" id="nhName" maxlength="8" placeholder="你的昵称" value="'+esc(lobby[0].name)+'" style="width:180px;"><br><br>'+
        '<button class="btn green" style="font-size:14px;padding:10px 22px;" onclick="netCreate()">🏠 创建房间</button></div>'+
      '<div style="width:40px;align-self:center;color:#666;">或</div>'+
      '<div style="width:220px;"><input class="netInput code" id="nhCode" maxlength="4" placeholder="房间号" style="margin-bottom:8px;"><br>'+
        '<input class="netInput" id="nhName2" maxlength="8" placeholder="你的昵称" style="width:180px;"><br><br>'+
        '<button class="btn blue" style="font-size:14px;padding:10px 22px;" onclick="netJoin()">🚪 加入房间</button></div>'+
    '</div>'+
    (saved?'<div style="margin-top:10px;"><button class="btn gray" onclick="netResume()">↩ 重新进入上次房间 '+esc(net.code)+'（断线重连）</button></div>':'')+
    '<div class="hint" style="margin-top:16px;">房主运行 <b>node server.js</b> 后，将服务器地址（如 <b>http://你的IP:8787</b>）分享给好友。<br>所有人打开本页面后输入同一服务器地址即可联机。</div>'+
    '<div style="margin-top:12px;"><button class="btn gold" style="font-size:13px;padding:8px 18px;" onclick="enterDevMode()">🛠️ 开发者模式（地图编辑）</button></div>';
}
async function netCreate(){
  const url=($('nhServerUrl').value||'').trim();
  if(!url) return netErr('请输入服务器地址');
  setServerUrl(url);
  const name=($('nhName').value||'').trim()||'房主';
  try{
    const j=await api('/api/create',{name});
    net.code=j.code;net.pid=j.pid;
    sessionStorage.setItem('net-code',j.code);sessionStorage.setItem('net-pid',j.pid);
    enterRoom();
  }catch(e){netErr('创建失败：'+e.message);}
}
async function netJoin(){
  const url=($('nhServerUrl').value||'').trim();
  if(!url) return netErr('请输入服务器地址');
  setServerUrl(url);
  const code=($('nhCode').value||'').trim().toUpperCase();
  const name=($('nhName2').value||'').trim()||('玩家'+(Math.floor(Math.random()*900)+100));
  if(!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) return netErr('请输入 4 位房间号（房主界面上金色大字）');
  try{
    const j=await api('/api/join',{code,name});
    net.code=j.code;net.pid=j.pid;
    sessionStorage.setItem('net-code',j.code);sessionStorage.setItem('net-pid',j.pid);
    enterRoom();
  }catch(e){netErr('加入失败：'+e.message);}
}
async function netResume(){
  try{
    const j=await api('/api/join',{code:net.code,pid:net.pid});
    net.pid=j.pid;
    enterRoom();
  }catch(e){
    sessionStorage.removeItem('net-code');sessionStorage.removeItem('net-pid');
    net.code=null;net.pid=null;
    netErr('无法回到房间：'+e.message);
  }
}
function enterRoom(){
  $('netFlow').innerHTML='<div class="netErr" id="netErr"></div><div style="padding:30px;color:#aaa;">正在进入房间…</div>';
  net.phase='';net.state=null;net.selected=null;net.sentPick=null;net.pickSending=false;
  net.gseq=0;net.pending=false;net.dirty=false;net.hostAid=0;net.hid=null;
  G=null;NET=null;
  showNetHud();
  startNetPolling();
}

/* ====================== 轮询 ====================== */
function startNetPolling(){
  stopNetPolling();
  netPoll();
  net.pollTimer=setInterval(netPoll,400);
}
function stopNetPolling(){
  if(net.pollTimer){clearInterval(net.pollTimer);net.pollTimer=null;}
  if(net.tickTimer){clearInterval(net.tickTimer);net.tickTimer=null;}
}
async function netPoll(){
  if(!net.code||!net.pid||net.busy)return;
  net.busy=true;
  try{
    let st;
    try{
      st=await apiGet('/api/state?code='+encodeURIComponent(net.code)+'&pid='+encodeURIComponent(net.pid));
    }catch(e){
      updateNetHud(false,'与服务器断开：'+e.message);
      return;
    }
    net.clockOffset=st.serverNow-Date.now();
    net.state=st;
    updateNetHud(true);
    if(st.phase!==net.phase){
      const prev=net.phase;
      net.phase=st.phase;net.sentPick=null;net.pickSending=false;
      if(prev==='ingame'&&st.phase!=='ingame'){
        G=null;NET=null;net.gseq=0;net.pending=false;net.dirty=false;
        document.getElementById('overlay').style.display='none';
        document.getElementById('lobby').style.display='flex';
      }
      netRenderPhase(st.phase);
    }
    netRenderTick(st);
    if(st.phase==='ingame') await netGameSync(st);
  }finally{
    net.busy=false;
  }
}
function srvNow(){return Date.now()+net.clockOffset;}

/* ====================== 对局同步 ====================== */
async function netHostSync(){
  let j;
  try{
    j=await apiGet('/api/g/pull?code='+encodeURIComponent(net.code)+'&pid='+encodeURIComponent(net.pid)+'&after='+net.hostAid);
  }catch(e){return;}
  if(j.hostHid&&j.hostHid!==net.hid){
    NET.frozen=true;
    netToast('⚠ 检测到房主页面已在其他设备/标签页打开，本页停止主持对局。');
    return;
  }
  let acted=false;
  for(const a of j.actions){
    net.hostAid=Math.max(net.hostAid,a.aid);
    if(!G||G.gameOver) break;
    if(curPlayer().id!==a.slot) continue;
    try{execIntent(a);acted=true;}catch(e){}
  }
  if(net.dirty||acted) hostSnapshotPush(false);
}
function hostSnapshotPush(immediate){
  if(!NET||!NET.host||NET.frozen||!G) return;
  const now=Date.now();
  if(!immediate&&now-net.lastPush<150) return;
  net.lastPush=now;net.dirty=false;
  api('/api/g/snapshot',{
    code:net.code,pid:net.pid,hid:net.hid,
    gstate:snapshotPayload(),gameOver:!!G.gameOver,lastAid:net.hostAid,
  }).catch(e=>netToast('快照上传失败：'+e.message));
}
async function netGuestSync(st){
  let j;
  try{
    j=await apiGet('/api/g/state?code='+encodeURIComponent(net.code)+'&pid='+encodeURIComponent(net.pid));
  }catch(e){return;}
  const me=st.you;
  if(!G||!NET){
    if(!j.gstate){ return; }
    if(me.isHost) adoptHostSnapshot(j);
    else adoptGuestSnapshot(j,true);
    return;
  }
  if(!me.isHost&&j.gseq!==net.gseq&&j.gstate) adoptGuestSnapshot(j,false);
}
async function netGameSync(st){
  if(G&&NET&&NET.host) await netHostSync();
  else await netGuestSync(st);
}
function adoptHostSnapshot(j){
  G=hydrateG(j.gstate);G.netMode=true;
  NET={slot:net.state.you.slot,host:true,frozen:false};
  net.hid='h'+Math.random().toString(36).slice(2)+Date.now().toString(36);
  net.hostAid=0;net.gseq=j.gseq;net.dirty=true;net.lastPush=0;
  document.getElementById('lobby').style.display='none';
  document.getElementById('overlay').style.display='none';
  updateAll();
  hostSnapshotPush(true);
}
function adoptGuestSnapshot(j,first){
  const prevOver=G?G.gameOver:false;
  G=hydrateG(j.gstate);G.netMode=true;
  NET={slot:net.state.you.slot,host:false,frozen:false};
  net.gseq=j.gseq;
  if(net.pending) net.pending=false;
  if(first){
    document.getElementById('lobby').style.display='none';
    document.getElementById('overlay').style.display='none';
  }
  if(G.gameOver&&(!prevOver||first)){
    endGame(G.endCamp||'killer',G.endReason||'对局结束');
  }else{
    updateAll();
  }
}
async function netSendIntent(intent){
  if(net.pending)return;
  net.pending=true;updateAll();
  try{
    await api('/api/g/action',{code:net.code,pid:net.pid,intent});
  }catch(e){
    net.pending=false;updateAll();
    netToast('操作失败：'+e.message);
  }
}
function netRestartFlow(){
  if(NET&&NET.host){ netReturnLobby(); }
  else{
    document.getElementById('lobby').style.display='flex';
    renderNetIngame();
  }
}
async function netReturnLobby(){
  try{
    await api('/api/g/reset',{code:net.code,pid:net.pid});
  }catch(e){netToast('返回大厅失败：'+e.message);return;}
  G=null;NET=null;net.gseq=0;net.pending=false;net.dirty=false;
  document.getElementById('lobby').style.display='flex';
}

/* ====================== Toast / HUD ====================== */
let toastTimer=null;
function netToast(msg,ms){
  const el=document.getElementById('netToast');
  if(!el)return;
  el.textContent=msg;el.style.display='block';
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{el.style.display='none';},ms||2600);
}
function showNetHud(){
  const h=document.getElementById('netHud');
  h.style.display='flex';
}
function updateNetHud(ok){
  const h=document.getElementById('netHud');
  if(!h||net.phase==='')return;
  const role=net.state&&net.state.you?(' · '+(net.state.you.isHost?'房主主持端':'远端玩家')):'';
  h.innerHTML=(ok?'<span class="dotOn"></span>':'<span class="dotOff"></span>')+
    '房间 '+esc(net.code)+role+'<span class="hudLeave" onclick="netLeaveRoom()">离开</span>';
}

/* ====================== 阶段渲染 ====================== */
function netRenderPhase(phase){
  if(phase==='lobby') renderNetLobby(true);
  else if(phase==='picking') renderNetPicking();
  else if(phase==='reveal') renderNetReveal();
  else if(phase==='ingame') renderNetIngame();
}
function netConnBar(){
  return '<div class="netBar" id="netConnBar"><span class="dotOn"></span>已连接服务器 · 房间 '+esc(net.code)+'</div>';
}
function renderNetLobby(full){
  const st=net.state,me=st.you;
  if(!me)return;
  const seats=[];
  for(let i=0;i<4;i++){
    const p=st.players[i];
    if(!p){seats.push('<div class="nseat"><div class="nsDot" style="background:#334;">?</div><div class="nsName" style="color:#555;">虚位以待</div><div class="nsTag wait">等待加入</div></div>');continue;}
    const cls='nseat'+(p.slot===me.slot?' s-me':'')+(p.ready?' s-ready':'');
    const tagCls=p.online?(p.ready?'nsTag ready':'nsTag wait'):'nsTag off';
    const tagTxt=!p.online?'已掉线':p.ready?'✔ 已准备':'未准备';
    seats.push('<div class="'+cls+'"><div class="nsDot" style="background:'+SLOT_COLORS[p.slot]+';">'+(p.slot+1)+'</div>'+
      '<div class="nsName">'+esc(p.name)+'</div><div class="'+tagCls+'">'+tagTxt+'</div>'+
      (p.isHost?'<div class="nsHost">房主</div>':'')+(p.slot===me.slot?'<div class="nsTag wait">(你)</div>':'')+'</div>');
  }
  const allReady=st.players.length===4&&st.players.every(p=>p.ready);
  if(full){
    $('netFlow').innerHTML=
      '<div class="netErr" id="netErr"></div>'+
      '<div style="font-size:12px;color:#888;">房间号（好友输入此房间号即可加入）</div>'+
      '<div class="roomCode">'+esc(st.code)+'</div>'+
      '<div class="netRow">'+seats.join('')+'</div>'+
      '<div id="netLobbyCtrl"></div>'+
      '<div style="margin-top:12px;"><button class="btn gray" onclick="netLeaveRoom()">离开房间</button></div>'+
      netConnBar();
  }else{
    const row=$('netFlow').querySelector('.netRow');
    if(row)row.innerHTML=seats.join('');
  }
  const ctrl=$('netLobbyCtrl');
  if(ctrl){
    if(me.isHost){
      ctrl.innerHTML='<button class="btn '+(me.ready?'gray':'green')+'" style="font-size:14px;padding:10px 26px;" onclick="netToggleReady()">'+(me.ready?'取消准备':'✔ 我已准备')+'</button>'+
        '<button class="btn '+(allReady?'green':'gray')+'" style="font-size:14px;padding:10px 26px; margin-left: 10px;"'+(allReady?'':' disabled')+' onclick="netStart()">🎲 全员就绪 · 开始随机身份与选角</button>'+
        '<div class="hint">开始后 4 人将在各自设备上<b>同时</b>看到身份并进行 7 秒 MOBA 式公开选角（角色不可重复）</div>';
    }else{
      ctrl.innerHTML='<button class="btn '+(me.ready?'gray':'green')+'" style="font-size:14px;padding:10px 26px;" onclick="netToggleReady()">'+(me.ready?'取消准备':'✔ 我已准备')+'</button>'+
        '<div class="hint">'+(allReady?'房主即将开始游戏…':'等待房主开始，全员准备后由房主统一开局')+'</div>';
    }
  }
}
async function netToggleReady(){
  const me=net.state.you;
  try{await api('/api/ready',{code:net.code,pid:net.pid,ready:!me.ready});}catch(e){netErr(e.message);}
}
async function netStart(){
  try{await api('/api/start',{code:net.code,pid:net.pid});}catch(e){netErr(e.message);}
}
async function netLeaveRoom(){
  stopNetPolling();
  try{ if(net.code&&net.pid) await api('/api/heartbeat',{code:net.code,pid:net.pid}); }catch(e){}
  sessionStorage.removeItem('net-code');sessionStorage.removeItem('net-pid');
  net.code=null;net.pid=null;
  G=null;NET=null;
  document.getElementById('netHud').style.display='none';
  document.getElementById('overlay').style.display='none';
  renderNetHome();
}
function renderNetPicking(){
  if(net.tickTimer){clearInterval(net.tickTimer);net.tickTimer=null;}
  net.selected=null;
  net.pickSending=false;
  const st=net.state,me=st.you,role=me.role;
  $('netFlow').innerHTML=
    '<div class="netErr" id="netErr"></div>'+
    '<div style="font-size:13px;">你的身份仅本设备可见：<b style="color:'+(role==='killer'?'#e94560':'#4ecca3')+';font-size:18px;">'+(role==='killer'?'🔪 屠夫':'🏃 逃生者')+'</b></div>'+
    '<div style="font-size:12px;color:#888;">全员<b style="color:#eee;">同时公开选角</b>，已选角色实时公示且不可重复（先确认者先得）</div>'+
    '<div class="csNum" id="csNumNet">7</div>'+
    '<div class="csTimer"><div class="csFill" id="csFillNet" style="width:100%;"></div></div>'+
    '<div class="pickSummary" id="netPickSummary"></div>'+
    '<div class="ccRow" id="netCards"></div>'+
    '<button class="btn green" id="csNetConfirm" style="font-size:13px;padding:8px 22px;" disabled onclick="netLockPick()">确认选择</button>'+
    '<div class="hint">7 秒内点卡片选中并确认；被抢先会提示另选，超时由服务器在剩余角色中随机分配。</div>'+
    netConnBar();
  netRenderCards();
  netRenderSummary();
  net.tickTimer=setInterval(netPickTick,100);
  netPickTick();
}
function netPickTick(){
  const st=net.state;if(!st||st.phase!=='picking')return;
  const rem=Math.max(0,st.pickDeadline-srvNow());
  const sec=Math.ceil(rem/1000);
  const num=$('csNumNet'),fill=$('csFillNet');
  if(!num)return;
  num.textContent=sec;
  num.className='csNum'+(sec<=3?' warn':'');
  fill.style.width=(rem/st.pickMs*100)+'%';
  fill.className='csFill'+(sec<=3?' warn':'');
}
function netRenderCards(){
  const st=net.state;
  if(!st||st.phase!=='picking')return;
  const me=st.you,host=$('netCards');
  if(!host||!me||!me.role)return;
  const role=me.role,list=CHARACTERS[role];
  const myPick=me.charId||net.sentPick||null;
  const takenBy={};
  st.players.forEach(p=>{ if(p.slot!==me.slot&&p.charId) takenBy[p.charId]=p.name; });
  if(net.selected&&takenBy[net.selected]) net.selected=null;
  host.innerHTML=list.map(c=>{
    const owner=takenBy[c.id];
    const mine=(c.id===myPick);
    const isTaken=owner!==undefined;
    const disabled=isTaken||!!myPick;
    const isSel=!disabled&&c.id===net.selected;
    let tag='';
    if(mine) tag='<div class="takenTag mineTag">✔ 你的选择</div>';
    else if(isTaken) tag='<div class="takenTag">已被 '+esc(owner)+' 选择</div>';
    else if(myPick) tag='<div class="takenTag">不可选择</div>';
    const cls='cc'+((mine||isSel)?' sel':(disabled?' taken':''));
    return '<div class="'+cls+'" id="ncc-'+c.id+'"'+(disabled?'':' onclick="netSelectChar(\''+c.id+'\')"')+'>'+
      tag+
      '<div class="ccIcon">'+c.icon+'</div>'+
      '<div class="ccName">'+c.name+'</div>'+
      '<div class="ccTag">'+c.tag+'</div>'+
      '<div class="ccStat">👣 步数：<b>'+c.ap+'</b> 步/回合</div>'+
      '<div class="ccStat">'+(role==='survivor'?'❤️ 血量：<b>'+c.hp+'</b>':'🩸 身份：屠夫')+'</div>'+
      '<div class="ccSkill">'+c.skills.map(sk=>'<div><b>'+sk.n+'</b>：'+sk.d+'</div>').join('')+'</div>'+
    '</div>';
  }).join('');
  const btn=$('csNetConfirm');
  if(btn&&!myPick&&!net.pickSending){
    if(net.selected&&!takenBy[net.selected]){btn.disabled=false;btn.textContent='确认选择';}
    else{btn.disabled=true;btn.textContent='确认选择';}
  }
}
function netRenderSummary(){
  const st=net.state;
  if(!st||st.phase!=='picking')return;
  const el=$('netPickSummary'),me=st.you;
  if(!el||!me)return;
  el.innerHTML=st.players.map(p=>{
    const role=p.role;
    const ch=p.charId?getChar(role,p.charId):null;
    const cls='psSlot'+(p.slot===me.slot?' cur':'')+(p.charId?' done':'');
    return '<div class="'+cls+'">'+
      '<div class="psName" style="color:'+SLOT_COLORS[p.slot]+'">'+esc(p.name)+(p.slot===me.slot?'（你）':'')+'</div>'+
      '<div class="psRole">'+(role==='killer'?'🔪屠夫':role==='survivor'?'🏃逃生者':'…')+'</div>'+
      '<div class="psChar">'+(ch?ch.icon+' '+ch.name:'<span style="color:#666;">选择中…</span>')+'</div>'+
    '</div>';
  }).join('');
}
function netSelectChar(id){
  const st=net.state;
  if(!st||st.phase!=='picking')return;
  if(net.sentPick||net.pickSending)return;
  const me=st.you;
  if(me&&me.charId)return;
  if(st.pickDeadline-srvNow()<=0)return;
  const card=document.getElementById('ncc-'+id);
  if(!card||card.classList.contains('taken'))return;
  if(net.selected===id){netLockPick();return;}
  net.selected=id;
  document.querySelectorAll('#netFlow .cc').forEach(el=>el.classList.toggle('sel',el.id==='ncc-'+id));
  const btn=$('csNetConfirm');
  if(btn){btn.disabled=false;btn.textContent='确认选择';}
}
async function netLockPick(){
  if(!net.selected||net.sentPick||net.pickSending)return;
  const st=net.state;
  if(!st||st.phase!=='picking')return;
  const cid=net.selected;
  net.pickSending=true;
  const btn=$('csNetConfirm');
  if(btn){btn.disabled=true;btn.textContent='提交中…';}
  try{
    await api('/api/pick',{code:net.code,pid:net.pid,charId:cid});
    net.sentPick=cid;
    net.pickSending=false;
    if(btn)btn.textContent='✔ 已提交，等待其他玩家…';
    netRenderCards();
  }catch(e){
    net.selected=null;
    net.pickSending=false;
    if(btn){btn.disabled=true;btn.textContent='确认选择';}
    netErr('❌ '+e.message+'（请另选一个角色）',$('netErr'));
    netRenderCards();
  }
}
function renderNetReveal(){
  if(net.tickTimer){clearInterval(net.tickTimer);net.tickTimer=null;}
  const st=net.state,me=st.you;
  $('netFlow').innerHTML=
    '<div class="netErr" id="netErr"></div>'+
    '<h2 style="color:#e94560;font-size:20px;margin-bottom:2px;">📜 角色选择公示</h2>'+
    '<div class="hint" style="margin-bottom:6px;">4 名玩家已在各自设备上<b>同时</b>完成 MOBA 式公开选角（统一 7 秒，角色不可重复，超时由服务器在剩余角色中随机）</div>'+
    st.players.map(p=>{
      const role=p.role,ch=getChar(role,p.charId);
      return '<div class="rvRow'+(p.slot===me.slot?' s-me':'')+'">'+
        '<div class="rvId"><span style="color:'+SLOT_COLORS[p.slot]+';font-weight:bold;">'+esc(p.name)+'</span>'+(p.slot===me.slot?' <span style="font-size:10px;color:#4e8eff;">(你)</span>':'')+(p.auto?' <span style="font-size:10px;color:#fa0;">超时随机</span>':'')+'<br><span style="color:'+(role==='killer'?'#e94560':'#4ecca3')+';font-size:12px;">'+(role==='killer'?'🔪 屠夫':'🏃 逃生者')+'</span></div>'+
        '<div class="rvIcon">'+ch.icon+'</div>'+
        '<div class="rvChar"><b style="font-size:14px;">'+ch.name+'</b> <span style="color:#888;">［'+ch.tag+'］</span><br>'+
        '👣 步数：'+ch.ap+' 步/回合'+(role==='survivor'?' ｜ ❤️ 血量：'+ch.hp:'')+'<br>'+
        '技能：'+ch.skills.map(s=>'<b>'+s.n+'</b> '+s.d).join('；')+'</div></div>';
    }).join('')+
    (me.isHost
      ? '<div style="margin-top:12px;"><button class="btn green" style="font-size:14px;padding:10px 28px;" onclick="netEnterGame()">▶ 房主进入正式游戏</button><div class="hint">房主设备主持权威对局并自动同步；4 人在各自设备操作自己的回合，按身份过滤视野</div></div>'
      : '<div class="netWait" style="font-size:14px;color:#aaa;">公示完毕，等待房主进入对局…<div class="hint">进入后你将在自己的设备上看到完整战场（仅自己身份的视野），轮到你时即可操作</div></div>')+
    netConnBar();
}
async function netEnterGame(){
  try{
    const st0=net.state;
    await api('/api/enter',{code:net.code,pid:net.pid});
    const st=net.state&&net.state.phase==='ingame'?net.state:st0;
    const names=st.players.map(p=>p.name);
    const chars={};st.players.forEach(p=>chars[p.slot]=p.charId);
    net.hid='h'+Math.random().toString(36).slice(2)+Date.now().toString(36);
    net.hostAid=0;net.gseq=0;net.dirty=false;net.lastPush=0;
    $('lobby').style.display='none';
    initGame({killerSlot:st.killerSlot,chars,names,netMode:true,isHost:true,mySlot:st.you.slot});
    hostSnapshotPush(true);
  }catch(e){netErr('进入失败：'+e.message);}
}
function renderNetIngame(){
  if(NET&&NET.host) return;
  const ended=net.state&&net.state.gOver;
  $('netFlow').innerHTML=
    '<div class="netWait"><div style="font-size:40px;">🎮</div>'+
    '<div style="font-size:16px;margin:10px 0;color:#eee;">'+(ended?'本局已结束':'对局开始中')+'</div>'+
    '<div style="color:#888;font-size:13px;">'+(ended?'等待房主返回大厅，开始下一局…':'正在等待房主设备下发对局画面，请稍候…')+'</div>'+
    '<div class="hint">进入后轮到你时，可直接在自己的设备上点击地图/使用技能</div></div>'+netConnBar();
}
function netRenderTick(st){
  if(st.phase==='lobby'){
    if($('netLobbyCtrl')) renderNetLobby(false);
    else renderNetLobby(true);
  }else if(st.phase==='picking'){
    netPickTick();
    netRenderCards();
    netRenderSummary();
  }
  const bar=$('netConnBar');
  if(bar)bar.innerHTML='<span class="dotOn"></span>已连接服务器 · 房间 '+esc(net.code);
}