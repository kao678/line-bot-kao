require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");

const app = express();
app.use(express.json());

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};
const client = new line.Client(config);

// ===== ADMIN =====
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",");

// ===== ROOMS =====
let PLAY_ROOM_ID = null;

// ===== SYSTEM =====
let SYSTEM = {
  OPEN: false,
  RATE_WIN: 0,
  MIN: 1,
  MAX: 999999
};

// ===== DATA =====
let USERS = {}; // userId => { credit, bets:[] }
let ALL_BETS = [];

// ===== WEBHOOK =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.sendStatus(200);
  } catch (e) {
    console.error("WEBHOOK ERROR:", e);
    res.sendStatus(500);
  }
});

const isAdmin = uid => ADMIN_IDS.includes(uid);

// ================= HANDLER =================
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text.trim();
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const roomId = event.source.groupId || event.source.roomId || null;

  console.log("MSG:", text, "UID:", userId, "ROOM:", roomId);

  USERS[userId] ||= { credit: 1000, bets: [] }; // ให้เครดิตเริ่มต้นทดสอบ

  // ===== AUTO SAVE ROOM =====
  if (!PLAY_ROOM_ID && isAdmin(userId)) {
    PLAY_ROOM_ID = roomId;
    console.log("SET PLAY_ROOM_ID =", PLAY_ROOM_ID);
  }

  // ===== ADMIN =====
  if (isAdmin(userId)) {
    if (text === "O") {
      SYSTEM.OPEN = true;
      return reply(replyToken, "🟢 เปิดรับแทงแล้ว");
    }
    if (text === "X") {
      SYSTEM.OPEN = false;
      return reply(replyToken, "🔴 ปิดรับแทงแล้ว");
    }
    if (text.startsWith("S")) {
      return calcResult(replyToken, text.slice(1));
    }
    if (text === "ROOM") {
      return reply(replyToken, `ROOM: ${PLAY_ROOM_ID}`);
    }
  }

  // ===== USER BET =====
  if (text.includes("/")) {
    const [bet, amt] = text.split("/");
    const money = parseInt(amt);

    if (!SYSTEM.OPEN && !isAdmin(userId)) {
      return reply(replyToken, "❌ ยังไม่เปิดรับแทง");
    }
    if (money < SYSTEM.MIN || money > SYSTEM.MAX) {
      return reply(replyToken, "❌ จำนวนเงินไม่ถูกต้อง");
    }
    if (USERS[userId].credit < money) {
      return reply(replyToken, "❌ เครดิตไม่พอ");
    }

    USERS[userId].credit -= money;
    const data = { userId, bet, money };
    USERS[userId].bets.push(data);
    ALL_BETS.push(data);

    return client.replyMessage(
      replyToken,
      receiptFlex(userId, bet, money, USERS[userId].credit)
    );
  }

  if (text === "C") {
    return reply(replyToken, `💰 เครดิตคงเหลือ ${USERS[userId].credit}`);
  }

  return reply(replyToken, "❓ คำสั่งไม่ถูกต้อง");
}

// ===== RESULT =====
function calcResult(token, result) {
  const summary = {};

  ALL_BETS.forEach(b => {
    let net = -b.money;
    if (b.bet === result) {
      net = b.money * 2;
      USERS[b.userId].credit += net;
    }
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
      styles: { body: { backgroundColor: "#000000" } },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: "🧾 ใบรับโพย", color: "#ff3333", weight: "bold", align: "center" },
          { type: "text", text: `ID: ${uid.slice(-5)}`, color: "#ffffff" },
          { type: "text", text: `แทง: ${bet} / ${money}`, color: "#ffffff" },
          { type: "text", text: `คงเหลือ: ${credit}`, color: "#00ff88" }
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
      styles: { body: { backgroundColor: "#000000" } },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: `🎲 ผลออก ${result}`, color: "#ff3333", weight: "bold" },
          ...Object.keys(summary).map(uid => ({
            type: "text",
            text: `${uid.slice(-5)} : ${summary[uid] > 0 ? "+" : ""}${summary[uid]}`,
            color: summary[uid] > 0 ? "#00ff88" : "#ff5555"
          }))
        ]
      }
    }
  };
}

function reply(token, text) {
  return client.replyMessage(token, { type: "text", text });
}

// ===== SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("BOT RUNNING", PORT));
