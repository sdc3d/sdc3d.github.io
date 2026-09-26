/* ===================================================================
   全局状态 & 坐标系统 & 快照序列化
=================================================================== */
let G;                 // 当前对局状态
let NET=null;          // 联机上下文 {slot,host,frozen}
let viewFloorOverride=null; // 非 null 时 render/移动使用此楼层

const DEV={
  on:false, terrain:T.WALL, editFloor:0, chestItem:'注射针',
  spawnTag:false, eraseMode:false,
  boardMode:false, boardState:'closed', windowDir:'v',
  narrowMode:false, narrowDir:'s'
};

/* ====================== (X, Y, Z) 三维坐标系统 ======================
 *   X：地图横坐标 (0..MAP_W-1)
 *   Y：地图纵坐标 (0..MAP_H-1)
 *   Z：楼层高度    -1=地下室，0=地面，1=二楼，2=三楼，……
 *
 * 每个 Z 是一张完整的独立地图。地图数据保存在 G.mapsByZ: Map<Z, 二维数组>。
 * 相同 (X,Y) 但不同 Z 的方块在棋盘上完全重叠，靠 Z 区分。
 * 楼梯 (X,Y,Z) 与 (X,Y,Z+1) 共享 X/Y —— 视觉上完全叠加。
 */
function progressKey(z,x,y){return (z||0)+':'+x+','+y;}
function cellKey3D(x,y,z){return (z||0)+':'+x+','+y;}
function parseCell3D(key){
  const i=key.indexOf(':');
  if(i<0) return null;
  const z=parseInt(key.slice(0,i))||0;
  const [x,y]=key.slice(i+1).split(',').map(Number);
  return {x,y,z};
}
function stairLink3D(x,y,z){return G.stairLinks?G.stairLinks.get(cellKey3D(x,y,z)):null;}
function holeLink3D(x,y,z){return G.holeLinks?G.holeLinks.get(cellKey3D(x,y,z)):null;}

/* ====================== 窄墙（方块某一条边的阻挡） ======================
 *  存储：G.narrowWalls: Set<"z:x,y,dir">
 *    dir='h' → 格子 (x,y) 的【下边】（(x,y) 与 (x,y+1) 之间）
 *    dir='v' → 格子 (x,y) 的【右边】（(x,y) 与 (x+1,y) 之间）
 *  一条边只存一次，由左/上方的格子作为基准，避免重复。
 */
function nwKey(z,x,y,dir){return (z|0)+':'+x+','+y+','+dir;}
function parseNwKey(key){
  const i=key.indexOf(':');
  if(i<0) return null;
  const z=parseInt(key.slice(0,i))||0;
  const p=key.slice(i+1).split(',');
  return {z,x:Number(p[0]),y:Number(p[1]),dir:p[2]};
}
function hasNarrowWall(z,x,y,dir){
  return !!(G&&G.narrowWalls&&G.narrowWalls.has(nwKey(z,x,y,dir)));
}
function toggleNarrowWall(z,x,y,dir){
  const k=nwKey(z,x,y,dir);
  if(G.narrowWalls.has(k)){G.narrowWalls.delete(k);return false;}
  G.narrowWalls.add(k);return true;
}

/* ====================== 快照序列化 ====================== */
function snapReplacer(k,v){
  if(v instanceof Map) return {__t:'m', e:Array.from(v.entries())};
  if(v instanceof Set) return {__t:'s', e:Array.from(v)};
  return v;
}
function snapReviver(k,v){
  if(v&&typeof v==='object'&&v.__t==='m') return new Map(v.e);
  if(v&&typeof v==='object'&&v.__t==='s') return new Set(v.e);
  return v;
}
function serializeG(){return JSON.stringify(G,snapReplacer);}
function hydrateG(o){return JSON.parse(typeof o==='string'?o:JSON.stringify(o),snapReviver);}
function snapshotPayload(){return JSON.parse(serializeG());}