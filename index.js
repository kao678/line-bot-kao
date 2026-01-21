require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);
// ===== SYSTEM DATA =====
let SYSTEM = {
  OPEN: false,
  RATE: 1
};
let USERS = {};
let ALL_BETS = [];

app.post("/webhook", line.middleware(config), (req, res) => {
  console.log("EVENT:", JSON.stringify(req.body));
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => {
      console.error("ERROR:", err);
      res.status(500).end();
    });
});

function handleEvent(event) {
  if (event.type !== "message") return Promise.resolve(null);
  if (event.message.type !== "text") return Promise.resolve(null);

  const text = event.message.text.trim();
  const userId = event.source.userId;
  const token = event.replyToken;

  // ===== ADMIN =====
  if (text === "O") {
    SYSTEM.OPEN = true;
    return reply(token, "🟢 เปิดรับแทงแล้ว");
  }

 if (text === "CLOSE") {
  SYSTEM.OPEN = false;
  return reply(token, "🔴 ปิดรับแทงแล้ว");
}

  if (text.startsWith("RATE")) {
    SYSTEM.RATE = parseFloat(text.split(" ")[1]);
    return reply(token, `⚙ ตั้งค่าน้ำ ${SYSTEM.RATE}`);
  }

  if (text === "RESET") {
    USERS = {};
    ALL_BETS = [];
    return reply(token, "♻ รีเซ็ตรอบเรียบร้อย");
  }

  if (text === "SUMMARY") {
    const total = ALL_BETS.reduce((sum, b) => sum + b.money, 0);
    return reply(token, `📊 สรุปรอบ\nจำนวนโพย: ${ALL_BETS.length}\nยอดรวม: ${total}`);
  }
// ===== RESULT =====
if (text.startsWith("RESULT")) {
  const result = text.split(" ")[1];
  if (!result) return reply(token, "❌ ใช้คำสั่ง: RESULT 1");

  const { win, lose } = calcResult(result);

  USERS = {};
  ALL_BETS = [];
  SYSTEM.OPEN = false;

  return reply(
    token,
`🎲 ผลออก: ${result}
💰 จ่าย: ${win}
💸 กิน: ${lose}
🔒 ปิดรอบแล้ว`
  );

  // ===== CANCEL =====
  if (text === "DL") {
    if (!USERS[userId]) return reply(token, "❌ ไม่มีโพย");
    USERS[userId].bets.forEach(b => {
      ALL_BETS = ALL_BETS.filter(x => x !== b);
    });
    USERS[userId].bets = [];
    return reply(token, "♻ ยกเลิกโพยแล้ว");
  }

  // ===== BETTING =====
  if (text.includes("/")) {
    if (!SYSTEM.OPEN) return reply(token, "❌ ปิดรับแทง");

    const [bet, amt] = text.split("/");
    const money = parseInt(amt);
    if (isNaN(money) || money <= 0) {
      return reply(token, "❌ รูปแบบแทงไม่ถูกต้อง");
    }

    if (!USERS[userId]) USERS[userId] = { bets: [] };

    const betData = { userId, bet, money };
    USERS[userId].bets.push(betData);
    ALL_BETS.push(betData);

    return reply(token, `🎯 รับโพยแล้ว\n${bet}/${money}`);
  }
return reply(token, "❓ คำสั่งไม่ถูกต้อง");
}
function calcResult(result) {
  let win = 0;
  let lose = 0;

  ALL_BETS.forEach(b => {
    if (b.bet === result) {
      win += b.money * SYSTEM.RATE;
    } else {
      lose += b.money;
    }
  });

  return { win, lose };
}
function reply(token, text) {
  return client.replyMessage(token, {
    type: "text",
    text
  });
}
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("RUNNING ON PORT", PORT);
});
