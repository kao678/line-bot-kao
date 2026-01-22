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

/* ===== ADMIN ===== */
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",");

/* ===== GAME STATE ===== */
let GAME = {
  OPEN: false,
};

let USERS = {};
let BETS = [];

/* ===== SERVER ===== */
app.get("/", (req, res) => {
  res.send("LINE BOT OPEN THUA RUNNING ✅");
});

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    for (const event of req.body.events) {
      await handleEvent(event);
    }
    res.status(200).end();
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

const isAdmin = (uid) => ADMIN_IDS.includes(uid);

/* ===== HANDLER ===== */
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text.trim();
  const userId = event.source.userId;
  const replyToken = event.replyToken;

  USERS[userId] ??= { credit: 1000 };

  /* ===== ADMIN COMMAND ===== */
  if (isAdmin(userId)) {
    if (text === "O") {
      GAME.OPEN = true;
      BETS = [];
      return reply(replyToken, "🟢 เปิดรับแทง");
    }
    if (text === "X") {
      GAME.OPEN = false;
      return reply(replyToken, "🔴 ปิดรับแทง");
    }
    if (text.startsWith("S")) {
      const result = text.slice(1);
      return calcResult(replyToken, result);
    }
  }

  /* ===== USER ===== */
  if (text === "C") {
    return reply(replyToken, `💰 เครดิต: ${USERS[userId].credit}`);
  }

  // รับโพย 1/100 , 123/20 , 555/20
  if (text.includes("/")) {
    if (!GAME.OPEN) return reply(replyToken, "❌ ยังไม่เปิดรับแทง");

    const [bet, amt] = text.split("/");
    const money = parseInt(amt);
    if (!money || money <= 0) return;

    if (USERS[userId].credit < money)
      return reply(replyToken, "❌ เครดิตไม่พอ");

    USERS[userId].credit -= money;
    BETS.push({ userId, bet, money });

    return reply(
      replyToken,
      `✅ รับโพย ${bet}/${money}\nคงเหลือ ${USERS[userId].credit}`
    );
  }
}

/* ===== CALC ===== */
function calcResult(token, result) {
  let summary = "";

  BETS.forEach((b) => {
    let rate = 0;

    if (["1", "2", "3", "4"].includes(b.bet) && b.bet === result) rate = 3;
    if (b.bet === "123" && ["1", "2", "3"].includes(result)) rate = 25;
    if (b.bet === "555" && result === "5") rate = 100;

    if (rate > 0) {
      const win = b.money * rate;
      USERS[b.userId].credit += win;
      summary += `\n🟢 ${b.userId.slice(-4)} +${win}`;
    } else {
      summary += `\n🔴 ${b.userId.slice(-4)} -${b.money}`;
    }
  });

  BETS = [];
  GAME.OPEN = false;

  return reply(token, `🎲 ผลออก ${result}\n${summary}`);
}

/* ===== REPLY ===== */
function reply(token, text) {
  return client.replyMessage(token, { type: "text", text });
}

/* ===== START ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("BOT RUNNING ON", PORT));
