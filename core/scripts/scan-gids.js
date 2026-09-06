#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const SCAN_CODE = (process.env.SCAN_CODE || "").trim();
const FARM_DIST =
  process.env.FARM_BOT_DIST ||
  path.resolve(__dirname, "../../core/src");
const TIMEOUT_MS = Math.max(
  10000,
  parseInt(process.env.SCAN_GIDS_TIMEOUT || "35000", 10),
);
const RESULT_FILE = process.env.SCAN_RESULT_FILE || "";

const diag = { logs: [], wsErrors: [], disconnect: null, startedAt: Date.now() };

function pushLog(s) {
  const str = String(s == null ? "" : s);
  diag.logs.push(str);
  if (diag.logs.length > 300) diag.logs.shift();
}

const _out = process.stdout.write.bind(process.stdout);
const _err = process.stderr.write.bind(process.stderr);
process.stdout.write = (c, e, cb) => {
  pushLog(c);
  return _out(c, e, cb);
};
process.stderr.write = (c, e, cb) => {
  pushLog(c);
  return _err(c, e, cb);
};

function diagTail() {
  const tail = diag.logs
    .join("")
    .replace(/\r?\n+/g, " ⏎ ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-1000);
  return tail ? " | 日志片段: " + tail : "";
}

function detectFailure() {
  const j = diag.logs.join("");
  if (/账号验证失败|验证失败|code=\s*\d+/.test(j))
    return "账号验证失败（授权码无效/已被使用/过期，网关拒绝登录）";
  if (/登录响应超时|登录.*超时/.test(j))
    return "网关登录响应超时（20s 内未返回登录回包）";
  if (diag.disconnect && diag.disconnect.reason)
    return "连接已断开: " + diag.disconnect.reason;
  if (diag.disconnect && diag.disconnect.source)
    return "连接已结束: " + diag.disconnect.source;
  if (diag.wsErrors.length)
    return "网关连接错误: " + JSON.stringify(diag.wsErrors[diag.wsErrors.length - 1]);
  const ws =
    typeof getWsErrorState === "function" ? getWsErrorState() : null;
  if (ws && ws.code) return "网关 WS 错误: " + JSON.stringify(ws);
  return null;
}

function writeResult(obj) {
  const s = JSON.stringify(obj) + "\n";
  if (RESULT_FILE) {
    try {
      fs.writeFileSync(RESULT_FILE, s);
    } catch (_) {}
  }
}

function toNum(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }
  if (typeof v.toNumber === "function") return v.toNumber();
  if (typeof v.low === "number" && typeof v.high === "number") {
    const Long = require(path.join(FARM_DIST, "utils", "utils")).Long;
    return Long && Long.isLong(v) ? v.toNumber() : 0;
  }
  return 0;
}

(async () => {
  pushLog(
    "SCAN_CODE len=" +
      SCAN_CODE.length +
      " prefix=" +
      SCAN_CODE.slice(0, 6).replace(/./g, "*"),
  );
  if (!SCAN_CODE) {
    writeResult({ ok: false, error: "缺少 SCAN_CODE" });
    process.exit(1);
  }

  let network, proto, utils;
  try {
    network = require(path.join(FARM_DIST, "utils", "network"));
    proto = require(path.join(FARM_DIST, "utils", "proto"));
    utils = require(path.join(FARM_DIST, "utils", "utils"));
  } catch (e) {
    writeResult({
      ok: false,
      error: "加载农场 bot 模块失败：" + e.message + diagTail(),
    });
    process.exit(1);
  }

  const { connect, sendMsgAsync, getUserState, cleanup, getWsErrorState, networkEvents } =
    network;
  const { types, loadProto } = proto;

  let context = null;
  let done = false;
  let checkTimer = null;

  const maybeFailFromDiag = () => {
    if (done) return;
    const reason = detectFailure();
    if (reason) fail("网关登录失败：" + reason);
  };

  const fail = (msg) => {
    if (done) return;
    done = true;
    if (checkTimer) clearInterval(checkTimer);
    clearTimeout(totalTimer);
    try {
      if (context && cleanup) cleanup(context);
    } catch (_) {}
    const reason = detectFailure();
    const detail =
      reason && msg.indexOf(reason) === -1 ? "（" + reason + "）" : "";
    writeResult({
      ok: false,
      error: msg + detail + diagTail(),
      diag: { wsErrors: diag.wsErrors, disconnect: diag.disconnect },
    });
    process.exit(1);
  };

  const success = (friends, debug) => {
    if (done) return;
    done = true;
    if (checkTimer) clearInterval(checkTimer);
    clearTimeout(totalTimer);
    try {
      if (context && cleanup) cleanup(context);
    } catch (_) {}
    writeResult({
      ok: true,
      self: selfInfo,
      friends,
      count: friends.length,
      debug: debug || null,
    });
    process.exit(0);
  };

  if (networkEvents && typeof networkEvents.on === "function") {
    networkEvents.on("ws_error", (e) => {
      diag.wsErrors.push(e);
      maybeFailFromDiag();
    });
    networkEvents.on("disconnected", (e) => {
      diag.disconnect = e || {};
      maybeFailFromDiag();
    });
  }

  checkTimer = setInterval(maybeFailFromDiag, 1500);

  const totalTimer = setTimeout(
    () => fail("网关登录/取好友超时" + diagTail()),
    TIMEOUT_MS,
  );

  process.on("uncaughtException", (e) =>
    fail("uncaughtException: " + e.message),
  );
  process.on("unhandledRejection", (e) =>
    fail(
      "unhandledRejection: " +
        (e && e.message ? e.message : String(e)),
    ),
  );

  let selfInfo = {};

  const seedGids = (process.env.SEED_GIDS || "")
    .split(/[,\s]+/)
    .map((s) => toNum((s || "").trim()))
    .filter((n) => n > 0);

  try {
    pushLog("proto: 开始加载 Protobuf 定义...");
    await loadProto();
    if (!types || !types.LoginRequest) {
      fail("Protobuf 定义加载不完整（缺少 LoginRequest），网关登录无法构造请求");
      return;
    }
    pushLog("proto: Protobuf 定义加载完成");
  } catch (e) {
    fail("加载 Protobuf 定义失败：" + e.message + diagTail());
    return;
  }

  try {
    context = await connect(SCAN_CODE, async () => {
      const st = getUserState ? getUserState() : {};
      selfInfo = {
        gid: toNum(st && st.gid),
        name: String((st && st.name) || ""),
        level: toNum(st && st.level),
        openId: String((st && st.openId) || ""),
      };

      const fr = await fetchAllGameFriends(
        sendMsgAsync,
        selfInfo.gid,
        seedGids,
      );
      clearTimeout(totalTimer);
      if (checkTimer) clearInterval(checkTimer);
      success(fr.list, fr.debug);
    });
  } catch (e) {
    clearTimeout(totalTimer);
    if (checkTimer) clearInterval(checkTimer);
    fail(
      "网关登录失败：" +
        (e && e.message ? e.message : String(e)),
    );
  }
})();

async function fetchAllGameFriends(sendMsgAsync, selfGid, seedGids) {
  const collected = [];
  const seen = new Set();
  const debug = {
    syncAllMutual: null,
    syncAllRecommended: null,
    candidateInput: null,
    getGameFriends: null,
    seed: null,
  };

  const add = (f) => {
    const gid = toNum(f && f.gid);
    if (gid <= 0 || seen.has(gid) || gid === selfGid) return;
    seen.add(gid);
    collected.push(normalizeFriend(f));
  };

  const seed = Array.isArray(seedGids)
    ? seedGids.filter((g) => g > 0 && g !== selfGid)
    : [];

  let candidateGids = [];
  try {
    const { body: replyBody } = await sendMsgAsync(
      "gamepb.friendpb.FriendService",
      "SyncAll",
      Buffer.alloc(0),
    );
    const sd = decodeSyncAllReply(replyBody);
    debug.syncAllMutual = sd.mutual.length;
    debug.syncAllRecommended = sd.recommended.length;
    candidateGids = Array.from(
      new Set([
        ...sd.mutual.map((f) => f.gid),
        ...sd.recommended.map((f) => f.gid),
      ]),
    ).filter((g) => g > 0 && g !== selfGid);
    debug.candidateInput = candidateGids.length;
  } catch (e) {
    debug.candidateInput =
      "err:" + (e && e.message ? e.message : String(e));
  }

  if (seed.length > 0) {
    candidateGids = Array.from(new Set([...candidateGids, ...seed])).filter(
      (g) => g > 0 && g !== selfGid,
    );
    debug.seed = seed.length;
  }

  if (candidateGids.length > 0) {
    try {
      const all = await fetchGameFriendsByGids(sendMsgAsync, candidateGids);
      debug.getGameFriends = all.length;
      for (const f of all) add(f);
    } catch (e) {
      debug.getGameFriends =
        "err:" + (e && e.message ? e.message : String(e));
    }
  }

  return { list: collected, debug };
}

function _pbVarint(n) {
  let v = BigInt(n);
  if (v < 0n) v += 1n << 64n;
  const out = [];
  while (true) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) out.push(b | 0x80);
    else {
      out.push(b);
      break;
    }
  }
  return Buffer.from(out);
}

function _pbTag(field, wireType) {
  return _pbVarint((field << 3) | wireType);
}

function _readVarint(buf, pos) {
  let shift = 0n,
    result = 0n;
  while (pos < buf.length) {
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7n;
  }
  return [result, pos];
}

function _skip(buf, pos, wireType) {
  if (wireType === 0) {
    const [, p] = _readVarint(buf, pos);
    return p;
  }
  if (wireType === 2) {
    const [len, p] = _readVarint(buf, pos);
    return p + Number(len);
  }
  if (wireType === 5) return pos + 4;
  if (wireType === 1) return pos + 8;
  return buf.length;
}

function encodeGetGameFriends(gids) {
  if (!gids || gids.length === 0) return Buffer.alloc(0);
  let body = Buffer.alloc(0);
  for (const g of gids)
    body = Buffer.concat([body, _pbTag(1, 0), _pbVarint(g)]);
  return body;
}

function decodeGameFriend(buf) {
  let gid = 0,
    name = "",
    headImg = "",
    openId = "";
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p1] = _readVarint(buf, pos);
    const field = Number(tag >> 3n);
    const wt = Number(tag & 7n);
    if (wt === 0) {
      const [v, np] = _readVarint(buf, p1);
      if (field === 1) gid = Number(v);
      pos = np;
    } else if (wt === 2) {
      const [len, p2] = _readVarint(buf, p1);
      const sub = buf.slice(p2, p2 + Number(len));
      if (field === 2) openId = sub.toString("utf8");
      else if (field === 3) name = sub.toString("utf8");
      else if (field === 4) headImg = sub.toString("utf8");
      pos = p2 + Number(len);
    } else pos = _skip(buf, p1, wt);
  }
  return { gid, name, headImg, openId };
}

function decodeGameFriends(bodyBuf) {
  if (!bodyBuf || bodyBuf.length === 0) return [];
  const friends = [];
  let pos = 0;
  while (pos < bodyBuf.length) {
    const [tag, p1] = _readVarint(bodyBuf, pos);
    const field = Number(tag >> 3n);
    const wt = Number(tag & 7n);
    if (field === 1 && wt === 2) {
      const [len, p2] = _readVarint(bodyBuf, p1);
      const f = decodeGameFriend(bodyBuf.slice(p2, p2 + Number(len)));
      if (f && f.gid) friends.push(f);
      pos = p2 + Number(len);
    } else pos = _skip(bodyBuf, p1, wt);
  }
  return friends;
}

function _extractMessageList(buf, fieldNo) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p1] = _readVarint(buf, pos);
    const f = Number(tag >> 3n);
    const wt = Number(tag & 7n);
    if (f === fieldNo && wt === 2) {
      const [len, p2] = _readVarint(buf, p1);
      out.push(buf.slice(p2, p2 + Number(len)));
      pos = p2 + Number(len);
    } else pos = _skip(buf, p1, wt);
  }
  return out;
}

function decodeRecommended(buf) {
  let gid = 0,
    name = "",
    avatar = "",
    openId = "",
    level = 0;
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p1] = _readVarint(buf, pos);
    const field = Number(tag >> 3n);
    const wt = Number(tag & 7n);
    if (wt === 0) {
      const [v, np] = _readVarint(buf, p1);
      if (field === 1) gid = Number(v);
      else if (field === 4) level = Number(v);
      pos = np;
    } else if (wt === 2) {
      const [len, p2] = _readVarint(buf, p1);
      const sub = buf.slice(p2, p2 + Number(len));
      if (field === 2) name = sub.toString("utf8");
      else if (field === 3) avatar = sub.toString("utf8");
      else if (field === 6) openId = sub.toString("utf8");
      pos = p2 + Number(len);
    } else pos = _skip(buf, p1, wt);
  }
  return { gid, name, avatar, openId, level };
}

function decodeSyncAllReply(bodyBuf) {
  if (!bodyBuf || bodyBuf.length === 0)
    return { mutual: [], recommended: [] };
  const mutual = _extractMessageList(bodyBuf, 1)
    .map(decodeGameFriend)
    .filter((f) => f && f.gid);
  const recommended = _extractMessageList(bodyBuf, 5)
    .map(decodeRecommended)
    .filter((f) => f && f.gid);
  return { mutual, recommended };
}

async function fetchGameFriendsByGids(sendMsgAsync, gids) {
  const body = encodeGetGameFriends(gids);
  const { body: replyBody } = await sendMsgAsync(
    "gamepb.friendpb.FriendService",
    "GetGameFriends",
    body,
  );
  return decodeGameFriends(replyBody);
}

function normalizeFriend(f) {
  const avatar = String(
    (f && (f.head_img || f.avatar || f.headImg || f.icon)) || "",
  );
  const gid = toNum(f && f.gid);
  const isSystem =
    gid === 10001 || (avatar && !/^https?:\/\//i.test(avatar));
  return {
    gid: String(gid),
    openId: String((f && (f.open_id || f.openId)) || ""),
    name: String((f && f.name) || ""),
    level: Number((f && f.level) || 0),
    gold: Number((f && f.gold) || 0),
    avatar: avatar,
    isSystem: !!isSystem,
  };
}
