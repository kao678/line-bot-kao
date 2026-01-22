require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");

const app = express();
app.use(express.json());

/* ===== LINE CONFIG ===== */
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);

/* ===== BASIC ===== */
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").filter(Boolean);
const isAdmin = (uid) => ADMIN_IDS.includes(uid);

/* ===== ROOMS ===== */
let PLAY_ROOM_ID = null;
let DEPOSIT_ROOM_ID = null;

/* ===== SYSTEM ===== */
let SYSTEM = {
  OPEN: false,
  RATE_WIN: 0,
  RATE_LOSE: 0,
  MIN: 1,
  MAX: 999999,
};

/* ===== DATA ===== */
let USERS = {};   // userId => { credit, bets: [], blocked }
let ALL_BETS = [];
let LAST_RESULT = null;

/* ===== HEALTH CHECK ===== */
app.get("/", (req, res) => res.status(200).send("OK"));

/* ===== WEBHOOK ===== */
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (e) {
    console.error("WEBHOOK ERROR:", e);
    res.status(500).end();
  }
});

/* ================= HANDLER ================= */
async function handleEvent(event) {
  // 🔒 กัน event ผีทุกชนิด (ตัวนี้ทำให้ไม่ 500)
  if (!event || event.type !== "message") return;
  if (!event.message || event.message.type !== "text") return;
  if (!event.source || !event.source.userId) return;

  const text = event.message.text.trim();
  const userId = event.source.userId;
  const token = event.replyToken;
  const roomId = event.source.groupId || event.source.roomId || null;

  // init user
  USERS[userId] ??= { credit: 0, bets: [], blocked: false };

  /* ===== AUTO SAVE ROOM ===== */
  if (!PLAY_ROOM_ID && isAdmin(userId) && text === "O") PLAY_ROOM_ID = roomId;
  if (!DEPOSIT_ROOM_ID && isAdmin(userId) && text.startsWith("N/")) DEPOSIT_ROOM_ID = roomId;

  /* ===== ADMIN : GLOBAL ===== */
  if (isAdmin(userId) && text === "ROOM") {
    return reply(token,
      `🏠 ROOM\nPLAY: ${PLAY_ROOM_ID || "-"}\nDEPOSIT: ${DEPOSIT_ROOM_ID || "-"}`
    );
  }

  /* ===== ADMIN : PLAY ROOM ===== */
  if (roomId === PLAY_ROOM_ID && isAdmin(userId)) {

    if (text === "O") {
      SYSTEM.OPEN = true;
      return reply(token, "🟢 เปิดรับแทงแล้ว");
    }

    if (text === "X") {
      SYSTEM.OPEN = false;
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
