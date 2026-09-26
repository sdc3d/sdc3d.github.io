/**
 * 暗夜追逃 · 在线联机房间服务器（零依赖，仅使用 Node.js 内置模块）
 * 启动：
 *   node server.js                  仅局域网（双击 start.bat）
 *   set WITH_TUNNEL=1&&node server.js  同时拉起 Cloudflare Quick Tunnel 公网临时域名
 *                                     （双击 start-cloud.bat，无需 Cloudflare 账号/域名）
 *
 * 职责：
 *   1. 房间创建/加入/准备，服务器统一随机分配身份
 *   2. 4 人在各自设备上【同时】7 秒 MOBA 式公开选角，角色不可重复，
 *      到点统一从「剩余角色」中随机结算并公示
 *   3. 正式对局中继：房主设备主持权威对局并上传 gstate 快照，
 *      其余玩家提交动作意图（actions），由房主按回合顺序执行
 * 同步方式：前端短轮询 GET /api/state + /api/g/* 与 POST 动作接口（无需 npm install）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 8787);
const PICK_MS = 7000;                 // 角色选择时长（与前端 PICK_SECONDS 一致）
const ROOM_TTL = 3 * 60 * 60 * 1000; // 房间最长存活
const OFFLINE_DROP = 30 * 1000;      // 心跳超时视为掉线（不删座，仅标记）
const BODY_MAX = 1024 * 1024;        // 快照体积上限（普通动作很小，快照约几十 KB）
const SNAPSHOT_MAX = 512 * 1024;     // gstate 序列化后上限
const ACTION_KEEP = 300;             // 房间内动作队列最大长度
const CHAR_IDS = {
  killer: ['servant'],
  survivor: ['athlete', 'doctor', 'magician'],
};

const rooms = new Map(); // code -> room

function log(...a) { console.log('[' + new Date().toISOString().slice(11, 19) + ']', ...a); }
function rid(len) { return crypto.randomBytes(len).toString('hex'); }
function newRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混 0/O/1/I
  for (let i = 0; i < 50; i++) {
    let c = '';
    for (let j = 0; j < 4; j++) c += alphabet[crypto.randomInt(alphabet.length)];
    if (!rooms.has(c)) return c;
  }
  return rid(3).toUpperCase();
}

function gcRoom(room) {
  if (Date.now() - room.createdAt > ROOM_TTL) { rooms.delete(room.code); return true; }
  // 所有玩家掉线超过 2 分钟且不在对局中则销毁
  const anyRecent = room.players.some(p => Date.now() - p.lastSeen < 2 * 60 * 1000);
  if (room.players.length && !anyRecent && room.phase !== 'ingame') { rooms.delete(room.code); return true; }
  return false;
}

/* 一局结束后房主点「返回大厅」：房间复用、身份/角色/快照全部清空 */
function resetRoomGame(room) {
  room.phase = 'lobby';
  room.killerSlot = -1;
  room.pickDeadline = 0;
  room.gstate = null;
  room.gseq = 0;
  room.actions = [];
  room.actionSeq = 0;
  room.gOver = false;
  room.hostHid = null;
  for (const p of room.players) {
    p.ready = false; p.role = null; p.charId = null; p.auto = false; p.picked = false;
    p.online = true; p.lastSeen = Date.now();
  }
}

/* ===================================================================
   ★ 修改点 1：新增 takenChars()
   返回房间内「已被占用」的角色集合（可排除某个玩家自身，用于「先确认先得」校验）
=================================================================== */
function takenChars(room, excludePid) {
  const t = new Set();
  for (const p of room.players) {
    if (excludePid && p.pid === excludePid) continue;
    const list = CHAR_IDS[p.role];
    if (list && p.charId && list.includes(p.charId)) t.add(p.charId);
  }
  return t;
}

/* ===================================================================
   ★ 修改点 2：finalizePicks()
   超时随机选角改为「从该身份剩余未选角色中随机」，保证全场不重复。
   若出现非法/重复的已选（理论上 /api/pick 已拦截），也在此回收再补随机。
=================================================================== */
function finalizePicks(room) {
  if (room.phase !== 'picking') return;

  // 第一遍：保留合法且未被重复占用的选择；非法/重复者标记为待分配
  const used = new Set();
  for (const p of room.players) {
    const list = CHAR_IDS[p.role];
    if (p.charId && list && list.includes(p.charId) && !used.has(p.charId)) {
      used.add(p.charId);
      p.auto = false;
    } else {
      p.charId = null;
      p.auto = true;
    }
  }

  // 第二遍：为超时 / 被抢占的玩家，从「该身份剩余角色」中随机补选（全场角色不重复）
  for (const p of room.players) {
    if (!p.charId) {
      const list = CHAR_IDS[p.role];
      const pool = list.filter(c => !used.has(c));
      const src = pool.length ? pool : list;   // 兜底：正常配置下 pool 不会为空
      p.charId = src[crypto.randomInt(src.length)];
      used.add(p.charId);
    }
    p.picked = true;
  }

  room.phase = 'reveal';
  log('房间', room.code, '角色选择结束：', room.players.map(p => p.name + '=' + p.role + ':' + p.charId).join(', '));
}

// 惰性结算：任何请求访问到已到点的房间时推进状态
function tickRoom(room) {
  if (room.phase === 'picking' && Date.now() >= room.pickDeadline) finalizePicks(room);
  for (const p of room.players) p.online = Date.now() - p.lastSeen < OFFLINE_DROP;
}

function publicState(room, viewerPid) {
  tickRoom(room);
  const reveal = room.phase === 'reveal' || room.phase === 'ingame';
  return {
    ok: true,
    code: room.code,
    phase: room.phase,
    hostPid: room.hostPid,
    serverNow: Date.now(),
    pickDeadline: room.pickDeadline || 0,
    pickMs: PICK_MS,
    killerSlot: reveal ? room.killerSlot : -1,
    gOver: !!room.gOver,
    players: room.players.map(p => ({
      slot: p.slot,
      name: p.name,
      ready: p.ready,
      online: p.online,
      isHost: p.pid === room.hostPid,
      // 选角阶段：他人的身份/角色严格保密；公示后全员可见
      role: reveal || p.pid === viewerPid ? p.role : null,
      charId: reveal || p.pid === viewerPid ? p.charId : null,
      auto: reveal ? !!p.auto : false,
      picked: room.phase === 'picking' ? !!p.charId && CHAR_IDS[p.role].includes(p.charId) : !!p.picked,
    })),
  };
}

function send(res, code, obj, headers) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  }, headers || {}));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let len = 0;
    const chunks = [];
    req.on('data', c => {
      len += c.length;
      if (len > BODY_MAX) { req.destroy(); return reject(new Error('body too large')); }
      chunks.push(c);
    });
    req.on('end', () => {
      const data = Buffer.concat(chunks).toString('utf8');
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function touch(room, pid) {
  const p = room.players.find(x => x.pid === pid);
  if (p) { p.lastSeen = Date.now(); p.online = true; }
}

/* ================= Cloudflare Quick Tunnel ================= */
let tunnelUrl = '';
let tunnelStarting = false;
const TUNNEL_URL_RE = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;
function findCloudflared() {
  if (process.env.CLOUDFLARED_PATH && fs.existsSync(process.env.CLOUDFLARED_PATH)) return process.env.CLOUDFLARED_PATH;
  const candidates = [
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    path.join(os.homedir(), 'cloudflared', 'cloudflared.exe'),
  ];
  return candidates.find(f => fs.existsSync(f)) || '';
}
function startTunnel() {
  if (tunnelStarting || tunnelUrl) return;
  const exe = findCloudflared();
  if (!exe) {
    log('未找到 cloudflared.exe，本次仅提供局域网访问（公网联机请先安装 Cloudflare Tunnel）。');
    return;
  }
  tunnelStarting = true;
  log('正在启动 Cloudflare Quick Tunnel（公网临时域名，约需 5~20 秒）…');
  let child;
  try {
    child = spawn(exe, ['tunnel', '--url', 'http://localhost:' + PORT, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (e) {
    tunnelStarting = false;
    log('cloudflared 启动失败：', e.message);
    return;
  }
  const onData = buf => {
    const s = buf.toString();
    const m = s.match(TUNNEL_URL_RE);
    if (m && !tunnelUrl) {
      tunnelUrl = m[0];
      log('========================================');
      log('🌍 公网访问地址（分享给任意网络的好友）：', tunnelUrl);
      log('   该地址为临时地址，服务器重启后会变化。');
      log('========================================');
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', code => {
    log('cloudflared 已退出（code=' + code + '），公网地址失效。');
    tunnelUrl = ''; tunnelStarting = false;
  });
  child.on('error', e => {
    tunnelStarting = false;
    log('cloudflared 错误：', e.message);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    // ---------- 静态文件 ----------
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/prototype.html';
      const file = path.join(__dirname, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
      if (!(file === __dirname || file.startsWith(__dirname + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); return res.end('404');
      }
      const buf = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length });
      return res.end(buf);
    }

    // ---------- GET API ----------
    if (req.method === 'GET') {
      if (url.pathname === '/api/tunnel') {
        return send(res, 200, { ok: true, url: tunnelUrl, starting: tunnelStarting && !tunnelUrl });
      }
      if (url.pathname === '/api/state') {
        const code = (url.searchParams.get('code') || '').toUpperCase();
        const pid = url.searchParams.get('pid') || '';
        const room = rooms.get(code);
        if (!room || gcRoom(room)) return send(res, 404, { ok: false, error: '房间不存在或已关闭' });
        touch(room, pid);
        const st = publicState(room, pid);
        st.you = (() => {
          const p = room.players.find(x => x.pid === pid);
          return p ? { slot: p.slot, role: p.role, charId: p.charId, ready: p.ready, isHost: p.pid === room.hostPid, auto: !!p.auto } : null;
        })();
        return send(res, 200, st);
      }
      /* 房主拉取尚未执行的动作意图（增量：aid > after） */
      if (url.pathname === '/api/g/pull') {
        const code = (url.searchParams.get('code') || '').toUpperCase();
        const pid = url.searchParams.get('pid') || '';
        const after = Number(url.searchParams.get('after') || 0) || 0;
        const room = rooms.get(code);
        if (!room || gcRoom(room)) return send(res, 404, { ok: false, error: '房间不存在或已关闭' });
        touch(room, pid);
        if (pid !== room.hostPid) return send(res, 403, { ok: false, error: '仅房主可拉取动作' });
        return send(res, 200, {
          ok: true,
          actions: room.actions.filter(a => a.aid > after),
          gseq: room.gseq,
          maxAid: room.actionSeq,
          hostHid: room.hostHid || '',
        });
      }
      /* 非房主（及重连的房主）下载最新权威快照 */
      if (url.pathname === '/api/g/state') {
        const code = (url.searchParams.get('code') || '').toUpperCase();
        const pid = url.searchParams.get('pid') || '';
        const room = rooms.get(code);
        if (!room || gcRoom(room)) return send(res, 404, { ok: false, error: '房间不存在或已关闭' });
        touch(room, pid);
        if (!room.players.some(p => p.pid === pid)) return send(res, 403, { ok: false, error: '你不在该房间' });
        return send(res, 200, {
          ok: true,
          gseq: room.gseq,
          gstate: room.gstate,
          gameOver: !!room.gOver,
          maxAid: room.actionSeq,
          hostHid: room.hostHid || '',
        });
      }
      return send(res, 404, { ok: false, error: 'not found' });
    }

    if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) {
      return send(res, 404, { ok: false, error: 'not found' });
    }
    const b = await readBody(req).catch(() => null);
    if (!b) return send(res, 400, { ok: false, error: '请求格式错误' });
    const code = (b.code || '').toUpperCase();
    const room = url.pathname === '/api/create' ? null : rooms.get(code);
    if (room) gcRoom(room);

    switch (url.pathname) {
      case '/api/create': {
        const name = String(b.name || '房主').trim().slice(0, 8) || '房主';
        const c = newRoomCode();
        const pid = rid(8);
        const room = {
          code: c, hostPid: pid, phase: 'lobby',
          players: [{ pid, slot: 0, name, ready: false, online: true, lastSeen: Date.now(), role: null, charId: null, auto: false, picked: false }],
          killerSlot: -1, pickDeadline: 0, createdAt: Date.now(),
          // 对局中继字段
          gstate: null, gseq: 0, actions: [], actionSeq: 0, gOver: false, hostHid: null,
        };
        rooms.set(c, room);
        log('创建房间', c, '房主', name);
        return send(res, 200, { ok: true, code: c, pid, slot: 0 });
      }

      case '/api/join': {
        if (!room) return send(res, 404, { ok: false, error: '房间不存在' });
        // 断线重连
        if (b.pid) {
          const exist = room.players.find(p => p.pid === b.pid);
          if (exist) { touch(room, exist.pid); exist.online = true; return send(res, 200, { ok: true, code, pid: exist.pid, slot: exist.slot, resumed: true }); }
        }
        const name = String(b.name || '玩家').trim().slice(0, 8) || '玩家';
        if (room.phase !== 'lobby') return send(res, 403, { ok: false, error: '游戏已开始，无法加入' });
        if (room.players.length >= 4) return send(res, 403, { ok: false, error: '房间已满（4人）' });
        if (room.players.some(p => p.name === name)) return send(res, 409, { ok: false, error: '房间内已有同名玩家' });
        const pid = rid(8);
        const slot = room.players.length;
        room.players.push({ pid, slot, name, ready: false, online: true, lastSeen: Date.now(), role: null, charId: null, auto: false, picked: false });
        log('房间', code, '加入', name, '(' + (slot + 1) + '/4)');
        return send(res, 200, { ok: true, code, pid, slot });
      }

      case '/api/heartbeat': {
        if (!room) return send(res, 404, { ok: false, error: '房间不存在' });
        touch(room, b.pid);
        return send(res, 200, { ok: true });
      }

      case '/api/ready': {
        if (!room) return send(res, 404, { ok: false, error: '房间不存在' });
        const p = room.players.find(x => x.pid === b.pid);
        if (!p) return send(res, 403, { ok: false, error: '你不在该房间' });
        if (room.phase !== 'lobby') return send(res, 403, { ok: false, error: '游戏已开始' });
        p.ready = !!b.ready; p.lastSeen = Date.now();
        return send(res, 200, { ok: true });
      }

      case '/api/start': {
        if (!room) return send(res, 404, { ok: false, error: '房间不存在' });
        if (b.pid !== room.hostPid) return send(res, 403, { ok: false, error: '仅房主可开始' });
        if (room.phase !== 'lobby') return send(res, 403, { ok: false, error: '房间不在准备阶段' });
        if (room.players.length !== 4) return send(res, 403, { ok: false, error: '需要 4 名玩家' });
        if (!room.players.every(p => p.ready)) return send(res, 403, { ok: false, error: '尚有玩家未准备' });
        // 服务器统一随机身份：1 屠夫 + 3 逃生者
        room.killerSlot = crypto.randomInt(4);
        room.players.forEach(p => { p.role = p.slot === room.killerSlot ? 'killer' : 'survivor'; p.charId = null; p.auto = false; p.picked = false; });
        room.phase = 'picking';
        room.pickDeadline = Date.now() + PICK_MS;
        log('房间', code, '开始选角，屠夫座位=', room.killerSlot, '截止=', room.pickDeadline);
        return send(res, 200, { ok: true, pickDeadline: room.pickDeadline });
      }

      /* ===================================================================
         ★ 修改点 3：/api/pick
         增加「先确认先得」校验：已被其他玩家选走的角色直接拒绝，
         前端收到 409 后提示玩家另选，保证公开选角全程不重复。
      =================================================================== */
      case '/api/pick': {
        if (!room) return send(res, 404, { ok: false, error: '房间不存在' });
        tickRoom(room);
        const p = room.players.find(x => x.pid === b.pid);
        if (!p) return send(res, 403, { ok: false, error: '你不在该房间' });
        if (room.phase !== 'picking') return send(res, 403, { ok: false, error: '当前不是选角阶段' });
        const charId = String(b.charId || '');
        if (!CHAR_IDS[p.role].includes(charId)) return send(res, 400, { ok: false, error: '非法的角色选择' });
        // 已被其他玩家抢先选走 → 拒绝，前端提示另选
        if (takenChars(room, p.pid).has(charId)) {
          return send(res, 409, { ok: false, error: '该角色已被其他玩家抢先选择，请另选' });
        }
        p.charId = charId; p.auto = false; p.lastSeen = Date.now();
        return send(res, 200, { ok: true });
      }

      case '/api/enter': {
        // 房主在公示后进入对局（房主设备主持权威对局）
        if (!room) return send(res, 404, { ok: false, error: '房间不存在' });
        if (b.pid !== room.hostPid) return send(res, 403, { ok: false, error: '仅房主可进入' });
        tickRoom(room);
        if (room.phase !== 'reveal') return send(res, 403, { ok: false, error: '尚未公示' });
        room.phase = 'ingame';
        // 进入新对局：清空上一局中继残留
        room.gstate = null; room.gseq = 0; room.actions = []; room.actionSeq = 0; room.gOver = false; room.hostHid = null;
        return send(res, 200, { ok: true });
      }

      /* ---------- 对局中继 ---------- */

      case '/api/g/action': {
        // 玩家提交动作意图，服务器只做转发，不做游戏规则裁决
        if (!room) return send(res, 404, { ok: false, error: '房间不存在' });
        if (room.phase !== 'ingame') return send(res, 403, { ok: false, error: '当前不在对局中' });
        if (room.gOver) return send(res, 403, { ok: false, error: '对局已结束' });
        const p = room.players.find(x => x.pid === b.pid);
        if (!p) return send(res, 403, { ok: false, error: '你不在该房间' });
        const intent = b.intent;
        if (!intent || typeof intent !== 'object') return send(res, 400, { ok: false, error: '缺少动作内容' });
        const rec = { aid: ++room.actionSeq, pid: p.pid, slot: p.slot, ts: Date.now() };
        if (intent.type === 'click') {
          const x = Number(intent.x), y = Number(intent.y);
          if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 18 || y < 0 || y >= 14) {
            return send(res, 400, { ok: false, error: '非法坐标' });
          }
          rec.type = "click"; rec.x = x; rec.y = y; if (intent.targetFloor !== undefined && intent.targetFloor !== null) rec.targetFloor = Number(intent.targetFloor);
        } else if (intent.type === 'end') {
          rec.type = 'end';
        } else if (intent.type === 'button') {
          const allow = ['putBoard', 'inject', 'medkit', 'rescue', 'puppet', 'breakBoard', 'servantMark', 'recallMarks', 'boost', 'buy', 'end'];
          const name = String(intent.name || '');
          if (!allow.includes(name)) return send(res, 400, { ok: false, error: '非法动作' });
          rec.type = 'button'; rec.name = name;
          if (name === 'buy') rec.item = intent.item && typeof intent.item === 'object' ? intent.item : null;
        } else {
          return send(res, 400, { ok: false, error: '未知动作类型' });
        }
        room.actions.push(rec);
        if (room.actions.length > ACTION_KEEP) room.actions.shift();
        return send(res, 200, { ok: true, aid: rec.aid });
      }

      case '/api/g/snapshot': {
        // 房主上传权威快照；lastAid 之前的动作视为已消化并清除
        if (!room) return send(res, 404, { ok: false, error: '房间不存在' });
        if (b.pid !== room.hostPid) return send(res, 403, { ok: false, error: '仅房主可上传快照' });
        if (room.phase !== 'ingame') return send(res, 403, { ok: false, error: '当前不在对局中' });
        if (!b.gstate || typeof b.gstate !== 'object') return send(res, 400, { ok: false, error: '缺少快照' });
        let raw;
        try { raw = JSON.stringify(b.gstate); } catch { return send(res, 400, { ok: false, error: '快照无法序列化' }); }
        if (raw.length > SNAPSHOT_MAX) return send(res, 413, { ok: false, error: '快照过大' });
        room.gstate = b.gstate;
        room.gseq++;
        room.gOver = !!b.gameOver;
        if (b.hid) room.hostHid = String(b.hid);
        const lastAid = Number(b.lastAid || 0) || 0;
        if (lastAid > 0) room.actions = room.actions.filter(a => a.aid > lastAid);
        return send(res, 200, { ok: true, gseq: room.gseq });
      }

      case '/api/g/reset': {
        // 对局结束后房主带全体返回房间大厅，可准备后开新一局
        if (!room) return send(res, 404, { ok: false, error: '房间不存在' });
        if (b.pid !== room.hostPid) return send(res, 403, { ok: false, error: '仅房主可返回大厅' });
        if (room.phase !== 'ingame') return send(res, 403, { ok: false, error: '当前不在对局中' });
        resetRoomGame(room);
        log('房间', code, '对局结束，全体返回大厅');
        return send(res, 200, { ok: true });
      }

      default:
        return send(res, 404, { ok: false, error: '未知接口' });
    }
  } catch (e) {
    log('服务器错误：', e && e.stack || e);
    if (!res.headersSent) send(res, 500, { ok: false, error: '服务器内部错误' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const lans = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name]) {
      if (ni.family === 'IPv4' && !ni.internal) lans.push(ni.address);
    }
  }
  log('暗夜追逃房间服务器已启动');
  log('本机访问：  http://localhost:' + PORT + '/');
  for (const ip of lans) log('局域网访问：http://' + ip + ':' + PORT + '/  （同一 Wi-Fi/局域网可直接打开）');
  if (process.env.WITH_TUNNEL === '1') startTunnel();
});