require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

/* ===== LINE CONFIG ===== */
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);

const ADMIN_ID = process.env.ADMIN_ID;

/* ===== SYSTEM ===== */
let SYSTEM = {
  OPEN: false,
};

let CURRENT_ROUND = {
  bets: [],   // [{ userId, bet, amount }]
};

let ROUND_HISTORY = [];

/* ===== WEBHOOK ===== */
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

/* ===== HANDLER ===== */
async function handleEvent(event) {
  if (event.type !== "message") return;
  if (event.message.type !== "text") return;

  const text = event.message.text.trim();
  const userId = event.source.userId;
  const token = event.replyToken;
  const isAdmin = userId === ADMIN_ID;

  /* ===== ADMIN COMMAND ===== */
  if (text === "O" && isAdmin) {
    SYSTEM.OPEN = true;
    CURRENT_ROUND = { bets: [] };
    return reply(token, "🟢 เปิดรับเดิมพันแล้ว");
  }

  if (text === "X" && isAdmin) {
    SYSTEM.OPEN = false;
    return reply(token, "🔴 ปิดรับเดิมพันแล้ว");
  }

  if (text === "RESET" && isAdmin) {
    CURRENT_ROUND = { bets: [] };
    return reply(token, "♻ รีรอบเรียบร้อย");
  }

  /* ===== RESULT ===== */
  if (text.startsWith("S") && isAdmin) {
    const result = text.substring(1);
    if (!result) return reply(token, "❌ ใช้: S123");

    const summary = {};

    CURRENT_ROUND.bets.forEach(b => {
      let win = 0;

      // เดี่ยว
      if (b.bet.length === 1) {
        win = b.bet === result ? b.amount : -b.amount;
      }

      // ตอง / สเปเชียล (เช่น 111)
      if (b.bet.length === 3 && new Set(b.bet).size === 1) {
        win = b.bet === result ? b.amount * 10 : -b.amount;
      }

      summary[b.userId] = (summary[b.userId] || 0) + win;
    });

    ROUND_HISTORY.push({
      result,
      bets: CURRENT_ROUND.bets,
      summary,
    });

    SYSTEM.OPEN = false;
    CURRENT_ROUND = { bets: [] };

    let msg = `🎲 ผลออก: ${result}\n📊 สรุปเดิมพนัน`;
    Object.keys(summary).forEach(uid => {
      const v = summary[uid];
      msg += `\n• ${uid.slice(-5)} : ${v >= 0 ? "+" : ""}${v}`;
    });

    return reply(token, msg);
  }

  /* ===== CUSTOMER ===== */
  if (text.includes("/")) {
    if (!SYSTEM.OPEN) return reply(token, "❌ ปิดรับเดิมพัน");

    const [bet, amt] = text.split("/");
    const amount = parseInt(amt);

    if (!bet || isNaN(amount) || amount <= 0) {
      return reply(token, "❌ รูปแบบแทงไม่ถูกต้อง");
    }

    CURRENT_ROUND.bets.push({ userId, bet, amount });
    return reply(token, `🎯 รับโพยแล้ว\n${bet}/${amount}`);
  }

  if (text === "C") {
    const myBets = CURRENT_ROUND.bets.filter(b => b.userId === userId);
    if (myBets.length === 0) return reply(token, "❌ ยังไม่มีโพย");

    let msg = "📄 โพยของคุณ";
    myBets.forEach(b => {
      msg += `\n${b.bet}/${b.amount}`;
    });
    return reply(token, msg);
  }

  if (text === "DL") {
    CURRENT_ROUND.bets = CURRENT_ROUND.bets.filter(b => b.userId !== userId);
    return reply(token, "♻ ยกเลิกโพยทั้งหมดแล้ว");
  }

  return reply(token, "❓ คำสั่งไม่ถูกต้อง");
}

/* ===== REPLY ===== */
function reply(token, text) {
  return client.replyMessage(token, { type: "text", text });
}

/* ===== START ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("RUNNING ON PORT", PORT));
