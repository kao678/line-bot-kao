require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

/* ================= CONFIG ================= */
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};
const client = new line.Client(config);

/* ================= ADMIN ================= */
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",");

/* ================= ROOMS ================= */
let PLAY_ROOM_ID = null;
let DEPOSIT_ROOM_ID = null;

/* ================= SYSTEM ================= */
let SYSTEM = {
  OPEN: false,
  RATE_WIN: 0,
  RATE_LOSE: 0,
  MIN: 1,
  MAX: 999999,
  FULL: 999999
};

/* ================= DATA ================= */
let USERS = {};
let ALL_BETS = [];
let LAST_RESULT = null;

/* ================= UTILS ================= */
const isAdmin = uid => ADMIN_IDS.includes(uid);

function initUser(uid) {
  if (!USERS[uid]) {
    USERS[uid] = {
      credit: 0,
      bets: [],
      blocked: false,
      playCount: 0,
      history: []
    };
  }
}

/* ================= WEBHOOK ================= */
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (e) {
    console.error("WEBHOOK ERROR:", e);
    res.status(200).end(); // ⚠️ ห้ามส่ง 500
  }
});

/* ================= HEALTH CHECK ================= */
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

/* ================= HANDLER ================= */
async function handleEvent(event) {
  try {
    // 🔒 กัน LINE Verify
    if (!event.replyToken || event.replyToken === "00000000000000000000000000000000") {
      return Promise.resolve(null);
    }

    if (event.type !== "message") return Promise.resolve(null);
    if (!event.message || event.message.type !== "text") return Promise.resolve(null);

    const text = event.message.text.trim();
    const userId = event.source.userId;
    const token = event.replyToken;
    const roomId = event.source.groupId || event.source.roomId || null;

    initUser(userId);

    /* ===== AUTO SAVE ROOM ===== */
    if (isAdmin(userId)) {
      if (!PLAY_ROOM_ID && (text === "O" || text === "0")) PLAY_ROOM_ID = roomId;
      if (!DEPOSIT_ROOM_ID && text.startsWith("N/")) DEPOSIT_ROOM_ID = roomId;
    }

    /* ===== ADMIN MENU ===== */
    if (text === "MENU" && isAdmin(userId)) {
      return client.replyMessage(token, adminFlex());
    }

    if (text === "ROOM" && isAdmin(userId)) {
      return reply(token, `🏠 ROOM\nPLAY: ${PLAY_ROOM_ID || "-"}\nDEPOSIT: ${DEPOSIT_ROOM_ID || "-"}`);
    }

    /* ===== ADMIN : PLAY ROOM ===== */
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
        ALL_BETS = LAST_RESULT.bets;
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

    /* ===== ADMIN : DEPOSIT ROOM ===== */
    if (roomId === DEPOSIT_ROOM_ID && isAdmin(userId)) {
      if (text.startsWith("N/")) SYSTEM.RATE_LOSE = parseFloat(text.split("/")[1]);
      if (text.startsWith("NC/")) SYSTEM.RATE_WIN = parseFloat(text.split("/")[1]);
      if (text.startsWith("MIN/")) SYSTEM.MIN = parseInt(text.split("/")[1]);
      if (text.startsWith("MAX/")) SYSTEM.MAX = parseInt(text.split("/")[1]);
      if (text.startsWith("FULL/")) SYSTEM.FULL = parseInt(text.split("/")[1]);

      if (text.match(/^X\w+\+\d+/)) {
        const [uid, amt] = text.split("+");
        initUser(uid);
        USERS[uid].credit += parseInt(amt);
        return reply(token, `➕ เติมเครดิต ${amt}`);
      }

      if (text.match(/^X\w+-\d+/)) {
        const [uid, amt] = text.split("-");
        initUser(uid);
        USERS[uid].credit -= parseInt(amt);
        return reply(token, `➖ ถอนเครดิต ${amt}`);
      }
    }

    /* ===== USER : PLAY ROOM ===== */
    if (roomId === PLAY_ROOM_ID) {
      if (USERS[userId].blocked) return reply(token, "⛔ ไอดีถูกบล็อก");

      if (text === "C") {
        return reply(token, `💰 เครดิต: ${USERS[userId].credit}`);
      }

      if (text === "DL" || text === "X") {
        USERS[userId].bets.forEach(b => {
          USERS[userId].credit += b.money;
          ALL_BETS = ALL_BETS.filter(x => x !== b);
        });
        USERS[userId].bets = [];
        return reply(token, "♻ ยกเลิกโพยแล้ว");
      }

      if (text.includes("/")) {
        if (!SYSTEM.OPEN) return reply(token, "❌ ปิดรับแทง");
        const [bet, amt] = text.split("/");
        const money = parseInt(amt);

        if (money < SYSTEM.MIN || money > SYSTEM.MAX)
          return reply(token, "❌ จำนวนเงินไม่ถูกต้อง");

        if (USERS[userId].credit < money)
          return reply(token, "❌ เครดิตไม่พอ");

        USERS[userId].credit -= money;
        const betData = { userId, bet, money };
        USERS[userId].bets.push(betData);
        ALL_BETS.push(betData);

        return client.replyMessage(token, receiptFlex(userId, bet, money, USERS[userId].credit));
      }
    }

    return reply(token, "❓ คำสั่งไม่ถูกต้อง");
  } catch (err) {
    console.error("HANDLE ERROR:", err);
    return Promise.resolve(null);
  }
}

/* ================= RESULT ================= */
function calcResult(token, result) {
  const summary = {};
  LAST_RESULT = { bets: [...ALL_BETS] };

  ALL_BETS.forEach(b => {
    const u = USERS[b.userId];
    u.playCount++;

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

/* ================= FLEX ================= */
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
          { type: "button", action: { type: "message", label: "ออกผล 1", text: "S1" } }
        ]
      }
    }
  };
}

function reply(token, text) {
  return client.replyMessage(token, { type: "text", text });
}

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("BOT RUNNING :", PORT));      SYSTEM.OPEN = false;
      return reply(token, "🔴 ปิดรับแทงแล้ว");
    }

    if (text === "RESET") {
      ALL_BETS = [];
      Object.values(USERS).forEach(u => u.bets = []);
      return reply(token, "♻ รีเซ็ตรอบแล้ว");
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
      const result = text.slice(1);
      return calcResult(token, result);
    }
  }

  /* ===== ADMIN : DEPOSIT ROOM ===== */
  if (roomId === DEPOSIT_ROOM_ID && isAdmin(userId)) {

    if (text.startsWith("N/")) SYSTEM.RATE_LOSE = +text.split("/")[1];
    if (text.startsWith("NC/")) SYSTEM.RATE_WIN = +text.split("/")[1];
    if (text.startsWith("MIN/")) SYSTEM.MIN = +text.split("/")[1];
    if (text.startsWith("MAX/")) SYSTEM.MAX = +text.split("/")[1];

    if (/^X.+\+\d+/.test(text)) {
      const [uid, amt] = text.split("+");
      USERS[uid] ??= { credit: 0, bets: [], blocked: false };
      USERS[uid].credit += +amt;
      return reply(token, `➕ เติมเครดิต ${uid} +${amt}`);
    }

    if (/^X.+-\d+/.test(text)) {
      const [uid, amt] = text.split("-");
      USERS[uid] ??= { credit: 0, bets: [], blocked: false };
      USERS[uid].credit -= +amt;
      return reply(token, `➖ ลบเครดิต ${uid} -${amt}`);
    }

    if (text.endsWith(" CR")) {
      const uid = text.split(" ")[0];
      return reply(token, `💰 เครดิต ${uid}: ${USERS[uid]?.credit || 0}`);
    }
  }

  /* ===== USER : PLAY ROOM ===== */
  if (roomId === PLAY_ROOM_ID) {

    if (USERS[userId].blocked) return reply(token, "⛔ ถูกบล็อก");

    if (text === "C") {
      return reply(token, `💰 เครดิต: ${USERS[userId].credit}`);
    }

    if (text === "DL" || text === "X") {
      USERS[userId].bets.forEach(b => {
        USERS[userId].credit += b.money;
        ALL_BETS = ALL_BETS.filter(x => x !== b);
      });
      USERS[userId].bets = [];
      return reply(token, "♻ ยกเลิกโพยแล้ว");
    }

    if (text.includes("/")) {
      if (!SYSTEM.OPEN) return reply(token, "❌ ปิดรับแทง");

      const [bet, amt] = text.split("/");
      const money = +amt;

      if (money < SYSTEM.MIN || money > SYSTEM.MAX)
        return reply(token, "❌ จำนวนเงินไม่ถูกต้อง");

      if (USERS[userId].credit < money)
        return reply(token, "❌ เครดิตไม่พอ");

      USERS[userId].credit -= money;
      const betData = { userId, bet, money };
      USERS[userId].bets.push(betData);
      ALL_BETS.push(betData);

      return reply(token, `🎯 รับโพยแล้ว\n${bet}/${money}`);
    }
  }

  return reply(token, "❓ คำสั่งไม่ถูกต้อง");
}

/* ===== RESULT ===== */
function calcResult(token, result) {
  LAST_RESULT = [...ALL_BETS];
  let msg = `🎲 ผลออก: ${result}\n`;

  ALL_BETS.forEach(b => {
    let net = -b.money;
    if (b.bet === result) {
      net = b.money * (1 + SYSTEM.RATE_WIN / 100);
      USERS[b.userId].credit += net;
    }
    msg += `• ${b.userId.slice(-5)} : ${net >= 0 ? "+" : ""}${net}\n`;
  });

  ALL_BETS = [];
  SYSTEM.OPEN = false;

  return reply(token, msg);
}

function reply(token, text) {
  return client.replyMessage(token, { type: "text", text });
}

/* ===== START ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("RUNNING ON", PORT));
