/* ===================================================================
   常量定义
=================================================================== */
const T={EMPTY:0,WALL:1,WATER:2,GRASS:3,GEN:4,CHEST:5,WINDOW:6,STAIRS:7,HOLE:8,EXIT:9,VOID:10};
const MAP_W=18, MAP_H=14, CELL=40;
const GEN_NEED=5, DOOR_NEED=2, GEN_TO_OPEN=3;
const DOWN_TURNS=2, MAX_DOWN=2, RESCUE_AP=7, CHEST_AP=3;

const TC={
  0:'#2a2a3e',1:'#555',2:'#1a5a7a',3:'#2a6a2a',4:'#c8a850',5:'#8a5a30',
  6:'#4a7aaa',7:'#7a5a3a',8:'#3a2a5a',9:'#0a8a4a',10:'transparent'
};
const TN={0:'空地',1:'墙体',2:'水体',3:'草丛',4:'电机',5:'箱子',6:'窗户',7:'楼梯',8:'破洞',9:'大门',10:'虚空'};

const TER_BLOCKED={1:true,2:true,4:true,5:true,9:true,10:true};
function isBlockedTerrain(t){return !!TER_BLOCKED[t];}

const SLOT_COLORS=['#e94560','#4ecca3','#4e8eff','#ffd700'];
const PICK_SECONDS=7;