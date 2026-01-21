require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");

const app = express();
app.use(express.json()); // <<< ตัวสำคัญมาก

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};
const client = new line.Client(config);

// ===== ADMIN =====
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",");

// ===== ROOMS =====
let PLAY_ROOM_ID = null;
let DEPOSIT_ROOM_ID = null;

// ===== SYSTEM =====
let SYSTEM = {
  OPEN: false,
  RATE_WIN: 0,
  MIN: 1,
  MAX: 999999
};

// ===== DATA =====
let USERS = {};
// USERS[userId] = { credit, bets, blocked, name, playCount, history }
let ALL_BETS = [];
let LAST_RESULT = null;

// ===== WEBHOOK =====
app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

const isAdmin = uid => ADMIN_IDS.includes(uid);

// ================= HANDLER =================
function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const text = event.message.text.trim();
  const userId = event.source.userId;
  const token = event.replyToken;
  const roomId = event.source.groupId || event.source.roomId || null;

  // init user (เฉพาะ userId จริง)
  if (!USERS[userId]) {
    USERS[userId] = {
      credit: 0,
      bets: [],
      blocked: false,
      name: "",
      playCount: 0,
      history: []
    };
  }

  // ===== AUTO SAVE ROOM =====
  if (!PLAY_ROOM_ID && (text === "O" || text === "0") && isAdmin(userId)) {
    PLAY_ROOM_ID = roomId;
  }
  if (!DEPOSIT_ROOM_ID && text.startsWith("N/") && isAdmin(userId)) {
    DEPOSIT_ROOM_ID = roomId;
  }

  // ===== ADMIN MENU =====
  if (text === "MENU" && isAdmin(userId)) {
    return client.replyMessage(token, adminFlex());
  }

  // ===== SHOW ROOM =====
  if (text === "ROOM" && isAdmin(userId)) {
    return reply(token, `🏠 ROOM\nPLAY: ${PLAY_ROOM_ID || "-"}\nDEPOSIT: ${DEPOSIT_ROOM_ID || "-"}`);
  }

  // ===== ADMIN : PLAY ROOM =====
  if (roomId === PLAY_ROOM_ID && isAdmin(userId)) {
    if (text === "O" || text === "0") {
      SYSTEM.OPEN = true;
      return reply(token, "🟢 เปิดรับแทงแล้ว");
    }
    if (text === "X") {
      SYSTEM.OPEN = false;
      return reply(token, "🔴 ปิดรับแทงแล้ว");
    }
    if (text === "RESET") {
      ALL_BETS = [];
      Object.values(USERS).forEach(u => (u.bets = []));
      return reply(token, "♻ รีรอบแล้ว");
    }
    if (text === "BACK" && LAST_RESULT) {
      ALL_BETS = LAST_RESULT;
      LAST_RESULT = null;
      return reply(token, "⏪ ย้อนผลแล้ว");
    }
    if (text === "REFUND") {
      ALL_BETS.forEach(b => USERS[b.userId].credit += b.money);
      ALL_BETS = [];
      return reply(token, "💸 คืนเงินเรียบร้อย");
    }
    if (text.startsWith("S")) {
      return calcResult(token, text.slice(1));
    }
  }

  // ===== ADMIN : DEPOSIT ROOM =====
  if (roomId === DEPOSIT_ROOM_ID && isAdmin(userId)) {
    if (text.startsWith("N/")) SYSTEM.RATE_WIN = parseFloat(text.split("/")[1]);
    if (text.startsWith("MIN/")) SYSTEM.MIN = parseInt(text.split("/")[1]);
    if (text.startsWith("MAX/")) SYSTEM.MAX = parseInt(text.split("/")[1]);

    if (text.startsWith("BLOCK/")) {
      const uid = text.split("/")[1];
      USERS[uid] = USERS[uid] || { credit:0,bets:[],blocked:false,name:"",playCount:0,history:[] };
      USERS[uid].blocked = !USERS[uid].blocked;
      return reply(token, USERS[uid].blocked ? `⛔ บล็อก ${uid}` : `✅ ปลดบล็อก ${uid}`);
    }

    if (text.startsWith("NM/")) {
      const [, uid, name] = text.split("/");
      USERS[uid] = USERS[uid] || { credit:0,bets:[],blocked:false,name:"",playCount:0,history:[] };
      USERS[uid].name = name;
      return reply(token, `🏷 บันทึกชื่อ ${uid} = ${name}`);
    }

    if (/^X\w+\+\d+/.test(text)) {
      const [uid, amt] = text.split("+");
      USERS[uid] = USERS[uid] || { credit:0,bets:[],blocked:false,name:"",playCount:0,history:[] };
      USERS[uid].credit += parseInt(amt);
      return reply(token, `➕ เติม ${amt}`);
    }

    if (text.endsWith(" CR")) {
      const uid = text.split(" ")[0];
      return reply(token, `💰 เครดิต ${uid}: ${USERS[uid]?.credit || 0}`);
    }

    if (text.endsWith(" LL")) {
      const uid = text.split(" ")[0];
      return reply(token, `📊 ${uid} เล่น ${USERS[uid]?.playCount || 0} รอบ`);
    }

    if (text.endsWith(" CX")) {
      const uid = text.split(" ")[0];
      const u = USERS[uid];
      if (!u) return reply(token, "❌ ไม่พบข้อมูล");
      let msg = `📈 ${u.name || uid}`;
      u.history.slice(-10).forEach(h => {
        msg += `\n• ${h.result} : ${h.net >= 0 ? "+" : ""}${h.net}`;
      });
      return reply(token, msg);
    }
  }

  // ===== USER : PLAY ROOM =====
  if (roomId === PLAY_ROOM_ID) {
    const u = USERS[userId];
    if (u.blocked) return reply(token, "⛔ ไอดีถูกบล็อก");

    if (text === "C") return reply(token, `💰 เครดิต: ${u.credit}`);

    if (text === "DL") {
      u.bets.forEach(b => {
        u.credit += b.money;
        ALL_BETS = ALL_BETS.filter(x => x !== b);
      });
      u.bets = [];
      return reply(token, "♻ ยกเลิกโพยแล้ว");
    }

    if (text.includes("/")) {
      if (!SYSTEM.OPEN) return reply(token, "❌ ปิดรับแทง");
      const [bet, amt] = text.split("/");
      const money = parseInt(amt);
      if (money < SYSTEM.MIN || money > SYSTEM.MAX) return reply(token, "❌ จำนวนเงินไม่ถูกต้อง");
      if (u.credit < money) return reply(token, "❌ เครดิตไม่พอ");

      u.credit -= money;
      const betData = { userId, bet, money };
      u.bets.push(betData);
      ALL_BETS.push(betData);

      return client.replyMessage(token, receiptFlex(userId, bet, money, u.credit));
    }
  }

  return reply(token, "❓ คำสั่งไม่ถูกต้อง");
}

// ===== RESULT =====
function calcResult(token, result) {
  const summary = {};
  LAST_RESULT = [...ALL_BETS];

  ALL_BETS.forEach(b => {
    const u = USERS[b.userId];
    u.playCount += 1;

    let net = -b.money;
    if (b.bet === result) {
      net = b.money * (1 + SYSTEM.RATE_WIN / 100);
      u.credit += net;
    }

    u.history.push({ result, net });
    summary[b.userId] = (summary[b.userId] || 0) + net;
  });

  ALL_BETS = [];
  SYSTEM.OPEN = false;

  return client.replyMessage(token, summaryFlex(result, summary));
}

// ===== FLEX =====
function receiptFlex(uid, bet, money, credit) {
  return {
    type: "flex",
    altText: "RECEIPT",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "🧾 ใบรับโพย", weight: "bold" },
          { type: "text", text: `ผู้เล่น: ${uid.slice(-5)}` },
          { type: "text", text: `โพย: ${bet}/${money}` },
          { type: "text", text: `เครดิตคงเหลือ: ${credit}` }
        ]
      }
    }
  };
}

function summaryFlex(result, summary) {
  return {
    type: "flex",
    altText: "SUMMARY",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: `🎲 ผลออก: ${result}`, weight: "bold" },
          ...Object.keys(summary).map(uid => ({
            type: "text",
            text: `• ${uid.slice(-5)} : ${summary[uid] >= 0 ? "+" : ""}${summary[uid]}`
          }))
        ]
      }
    }
  };
}

function adminFlex() {
  return {
    type: "flex",
    altText: "ADMIN",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "button", action: { type: "message", label: "เปิดรับแทง", text: "O" } },
          { type: "button", action: { type: "message", label: "ปิดรับแทง", text: "X" } },
          { type: "button", action: { type: "message", label: "ดู ROOM", text: "ROOM" } },
          { type: "button", action: { type: "message", label: "ออกผล 1", text: "S1" } },
          { type: "button", action: { type: "message", label: "ออกผล 2", text: "S2" } },
          { type: "button", action: { type: "message", label: "ออกผล 3", text: "S3" } },
          { type: "button", action: { type: "message", label: "ออกผล 4", text: "S4" } }
        ]
      }
    }
  };
}

function reply(token, text) {
  return client.replyMessage(token, { type: "text", text });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("RUNNING ON", PORT));
