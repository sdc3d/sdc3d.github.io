/* ===================================================================
   大厅 + 角色定义 + 开发者模式入口
=================================================================== */
let lobby=[0,1,2,3].map(i=>({slot:i,name:'玩家'+(i+1),ready:false}));

/* ====================== 角色定义 ====================== */
const CHARACTERS={
  killer:[
    {id:'servant',name:'仆人',icon:'🕯️',ap:16,tag:'标记收割型',
      skills:[{n:'万相化灰',d:'以自己为中心7×7范围内所有逃生者附加[血偿勒令]；可随时回收，每道勒令转化为1层[生命之契]，普攻时消耗1层使本次伤害+0.5（每回合限1次）',impl:true}]},
  ],
  survivor:[
    {id:'athlete',name:'运动员',icon:'🏈',ap:8,hp:2,tag:'高机动救援型',
      skills:[{n:'疾跑',d:'在自己回合内越过板子或窗户时，步数额外+3（每回合至多触发一次）',impl:true}]},
    {id:'doctor',name:'医生',icon:'💉',ap:7,hp:2,tag:'治疗支援型',
      skills:[{n:'自疗',d:'初始携带1个注射针',impl:true},{n:'治疗',d:'用医疗箱医治其他逃生者时只需消耗自己3步（免除队友3步）',impl:true}]},
    {id:'magician',name:'魔术师',icon:'🪄',ap:7,hp:2,tag:'迷惑牵制型',
      skills:[{n:'人偶',d:'初始携带2个木偶，可在自己所处位置放下；木偶被屠夫视作魔术师、无法区分，受到屠夫攻击后消失',impl:true}]},
  ]
};
function getChar(role,id){return CHARACTERS[role].find(c=>c.id===id)||CHARACTERS[role][0];}

/* ====================== 界面切换 ====================== */
function hideModes(){
  $('netFlow').style.display='none';
}

/* ====================== 开发者模式入口（从大厅进入） ====================== */
function enterDevMode(){
  document.getElementById('lobby').style.display='none';
  initGame({killerSlot:0,chars:{},names:['玩家1','玩家2','玩家3','玩家4']});
  DEV.on=true;
  const panel=document.getElementById('devPanel');
  panel.style.display='block';
  renderDevPalette();
  devRefreshFloorSel();
  updateAll();
}

/* ====================== 从开发者模式返回大厅 ====================== */
function returnToLobby(){
  DEV.on=false;
  document.getElementById('devPanel').style.display='none';
  G=null;NET=null;
  document.getElementById('lobby').style.display='flex';
  renderNetHome();
}
