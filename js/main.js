/* ===================================================================
   入口：点击处理 / 帮助 / 事件绑定
=================================================================== */
function clickAt(p,x,y,targetZ){
  if(G.gameOver) return;
  if(x===p.x&&y===p.y) return;
  if(!adjacent(p,x,y)) return;
  const pZ=p.floor||0;
  const hasTarget=(targetZ!==undefined&&targetZ!==null);
  const useZ=hasTarget?targetZ:pZ;
  const z=useZ;
  const ter=getTerrainAt(z,x,y);
  if(p.role==="survivor"&&p.health>0){
    if(ter===T.GEN) return doFixGen(p,x,y);
    if(ter===T.EXIT){
      if(isDoorOpen(x,y,z)) return doEscapeDoor(p,x,y);
      return doFixExit(p,x,y);
    }
    if(ter===T.CHEST) return doOpenChest(p,x,y);
  }
  if(p.role==="killer"&&p.health>0){
    if(ter===T.GEN){logMsg("屠夫无法修机");return;}
    if(ter===T.EXIT){logMsg("屠夫无法修大门");return;}
    if(ter===T.CHEST){logMsg("屠夫无法打开箱子");return;}
  }
  const target=getPlayerAtFloor(z,x,y);
  if(target&&target.id!==p.id){
    if(p.role==="killer"){
      if(target.role==="survivor"&&target.health>0) return doAttack(p,target);
      if(target.role==="survivor"&&target.health<=0){logMsg("倒地逃生者无法被攻击");return;}
    }
  }
  if(p.role==="killer"){
    const q=puppetAt(x,y,z);
    if(q) return doAttackPuppet(p,q);
  }
  if(tryMove(p,x,y,hasTarget?useZ:undefined)) afterAction();
}

function handleClick(e){
  if(!G) return;
  const cv=document.getElementById('cv');
  const rect=cv.getBoundingClientRect();
  const x=Math.floor((e.clientX-rect.left)/(rect.width/MAP_W));
  const y=Math.floor((e.clientY-rect.top)/(rect.height/MAP_H));
  if(x<0||x>=MAP_W||y<0||y>=MAP_H) return;
  if(DEV.on){ devEditTile(x,y); return; }
  if(G.gameOver) return;
  if(G.netMode){
    if(NET.frozen){netToast('本页面的房主主持会话已被顶替，请刷新页面重连');return;}
    const me=G.players[NET.slot];
    if(curPlayer().id!==me.id){netToast('还没轮到你行动，请等待你的回合');return;}
    if(NET.host){ clickAt(me,x,y,viewFloorOverride); net.dirty=true; return; }
    if(net.pending){netToast('上一步操作正在同步，请稍候…');return;}
    netSendIntent({type:'click',x,y,targetFloor:viewFloorOverride});
    return;
  }
  clickAt(curPlayer(),x,y,viewFloorOverride);
}

/* ====================== 帮助 ====================== */
function showHelp(){
  document.getElementById('ovTitle').textContent='游戏说明';
  document.getElementById('ovTitle').style.color='';
  document.getElementById('ovText').innerHTML=
    '1v3非对称回合制追逃游戏<br><br>'+
    '<b>开局流程</b>：输入服务器地址 → 创建/加入房间 → 4人准备 → 随机分配身份 → <b>MOBA 式公开选角</b>（每人 7 秒 · 角色不可重复）→ 全员公示 → 进入对局<br>'+
    '<b>三维坐标 (X,Y,Z)</b>：X/Y 为地图格，Z 为楼层高度。整张地图按 Z 分成多个独立楼层：-1=地下室，0=地面，1=二楼，2=三楼……每个 Z 拥有自己的完整地图。<br>'+
    '<b>楼梯/破洞</b>：楼梯 (X,Y,Z) 与 (X,Y,Z+1) 在棋盘上完全重叠。走到楼梯格后用「视图楼层」下拉框选择要走向的楼层，再点击相邻格即可走到该楼层的对应位置。破洞向下贯穿虚空，落到首个实体楼层<br>'+
    '<b>出生点</b>：所有玩家随机出生在地面 (Z=0) 上带金色虚线框的出生点方格<br>'+
    '<b>窄墙</b>：方块的一条边呈白色（发光），无法从该边通过。由开发者在「🧱 窄墙」模式下按上/下/左/右边放置或移除<br>'+
    '<b>箱子</b>：只有逃生者能开箱，消耗 <b>'+CHEST_AP+' 步</b><br>'+
    '<b>窗户</b>：中央一块长方形玻璃（水平/竖直两方向）；长边两格必须是墙。逃生者当空地；屠夫从一侧到另一侧额外花 1 步<br>'+
    '<b>回合</b>：逃生者（按座位顺序）→屠夫循环。八方向移动耗1步。<b>不再自动结束回合</b>，请在右侧「技能」栏点击「⏭ 结束回合」按钮进入下一位玩家（攻击逃生者命中后屠夫回合立即结束）<br>'+
    '<b>屠夫刀中效果</b>：命中逃生者后屠夫下一回合步数 -3；被刀逃生者下一回合步数 +3（未倒地时）<br>'+
    '<b>运动员[疾跑]</b>：在自己回合内越板/翻窗时步数 +3，<b>每回合至多触发一次</b>（板、窗不再各自计次）<br>'+
    '<b>屠夫跨楼层视野</b>：屠夫只能看到自己所在层的细节；当站在连接另一层的楼梯上时，可看到该连接层的逃生者/机器/箱子状态；否则只显示地形骨架<br>'+
    '<b>商店限制</b>：视野扩展仅生效 3 回合（含购买回合）；瞬移一整局至多购买 1 次<br>'+
    '<b>修机进度</b>：逃生者随时可见；屠夫只有相邻机器时才显示进度条<br>'+
    '<b>同格多人</b>：玩家可经过并重叠于同一格，重叠时由上到下依次变小<br>'+
    '<b>修机需整回合</b>：本回合若已做过其他行动，则不能修机/修门<br>'+
    '<b>不可进入格</b>：墙体、水体、电机、箱子、大门、虚空<br>'+
    '<b>开箱/修机/修门/撤离</b>：在目标格的<b>周围八格</b>点击该格<br>'+
    '<b>攻击</b>：耗3步；命中真人则屠夫回合结束、下回合步数-3；被击中者下回合+3步。+50金币。狂暴伤害+1<br>'+
    '<b>倒地</b>：0血倒地（3步爬行，2回合未救即死，最多倒地2次，第3次直接死亡）<br>'+
    '<b>救援</b>：同格救起（耗3步，回1血，被救者获7步独立小回合）<br>'+
    '<b>注射针/医疗箱</b>：回血道具，医生治疗只耗自己3步<br>'+
    '<b>修机</b>：修好3台机器后可修大门（每门2点）；开门后屠夫狂暴1回合<br>'+
    '<b>板/窗</b>：逃生者花1步放板阻挡屠夫；屠夫花3步破板+10金币<br>'+
    '<b>草丛</b>：草外看不到草内<br>'+
    '<b>开发者模式</b>：在大厅点击「🛠️ 开发者模式」进入。楼层下拉选择 Z 后点击放置地形；「🧱 窄墙」模式按 上/下/左/右 边点击格子放置/移除白色窄墙；「清空此层」删除整层；「导出」复制地图数据<br>'+
    '<b>胜利</b>：>1 名逃生者死亡 → 屠夫胜；≤1 名死亡且其余全部撤离 → 逃生者胜';
  document.getElementById('ovResume').style.display='inline-block';
  document.getElementById('overlay').style.display='flex';
}

/* ====================== 事件绑定 ====================== */
document.getElementById('cv').addEventListener('click',handleClick);
document.addEventListener('keydown',e=>{
  if((e.key==='d'||e.key==='D')&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    const tag=(document.activeElement&&document.activeElement.tagName)||'';
    if(tag==='INPUT'||tag==='TEXTAREA') return;
    if(G) toggleDev();
  }
});

/* ====================== 初始化 ====================== */
renderNetHome();