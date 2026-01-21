require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");

const app = express();
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
  RATE_LOSE: 0,
  RATE_WIN: 0,
  MIN: 1,
  MAX: 999999,
  FULL: 999999
};

// ===== DATA =====
let USERS = {};      // userId => { credit, bets: [] }
let ALL_BETS = [];
let LAST_RESULT = null;

// ===== SERVER =====
app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

const isAdmin = (uid) => ADMIN_IDS.includes(uid);

// ================= HANDLER =================
function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;
  const text = event.message.text.trim();
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const roomId = event.source.groupId || event.source.roomId || null;

  /* ===== AUTO SAVE ROOM ===== */
  if (!PLAY_ROOM_ID && (text === "O" || text === "0") && isAdmin(userId)) {
    PLAY_ROOM_ID = roomId;
  }
  if (!DEPOSIT_ROOM_ID && text.startsWith("N/") && isAdmin(userId)) {
    DEPOSIT_ROOM_ID = roomId;
  }

  /* ===== ADMIN MENU ===== */
  if (text === "MENU" && isAdmin(userId)) {
    return client.replyMessage(replyToken, adminFlex());
  }

  /* ===== SHOW ROOM ===== */
  if (text === "ROOM" && isAdmin(userId)) {
    return reply(replyToken,
      `🏠 ROOM\nPLAY: ${PLAY_ROOM_ID || "-"}\nDEPOSIT: ${DEPOSIT_ROOM_ID || "-"}`
    );
  }

  /* ===== ADMIN : PLAY ROOM ===== */
  if (roomId === PLAY_ROOM_ID && isAdmin(userId)) {
    if (text === "O" || text === "0") {
      SYSTEM.OPEN = true;
      return reply(replyToken, "🟢 เปิดรับแทงแล้ว");
    }
    if (text === "X") {
      SYSTEM.OPEN = false;
      return reply(replyToken, "🔴 ปิดรับแทงแล้ว");
    }
    if (text === "RESET") {
      USERS = {};
      ALL_BETS = [];
      return reply(replyToken, "♻ รีเซ็ตรอบแล้ว");
    }
    if (text === "BACK" && LAST_RESULT) {
      ALL_BETS = LAST_RESULT.bets;
      LAST_RESULT = null;
      return reply(replyToken, "⏪ ย้อนผลเรียบร้อย");
    }
    if (text === "REFUND") {
      ALL_BETS.forEach(b => USERS[b.userId].credit += b.money);
      ALL_BETS = [];
      return reply(replyToken, "💸 คืนเงินเรียบร้อย");
    }
    if (text.startsWith("S")) {
      const result = text.slice(1);
      return calcResult(replyToken, result);
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
      USERS[uid] = USERS[uid] || { credit: 0, bets: [] };
      USERS[uid].credit += parseInt(amt);
      return reply(replyToken, `➕ เติม ${amt}`);
    }
    if (text.match(/^X\w+-\d+/)) {
      const [uid, amt] = text.split("-");
      USERS[uid] = USERS[uid] || { credit: 0, bets: [] };
      USERS[uid].credit -= parseInt(amt);
      return reply(replyToken, `➖ ถอน ${amt}`);
    }
    if (text.endsWith("CR")) {
      const uid = text.split(" ")[0];
      return reply(replyToken, `💰 เครดิต ${uid}: ${USERS[uid]?.credit || 0}`);
    }
  }

  /* ===== USER : PLAY ROOM ===== */
  if (roomId === PLAY_ROOM_ID) {
    if (text === "C") {
      const u = USERS[userId];
      return reply(replyToken, u ? `💰 เครดิต: ${u.credit}` : "ยังไม่มีเครดิต");
    }
    if (text === "DL" || text === "X") {
      if (!USERS[userId]) return reply(replyToken, "ไม่มีโพย");
      USERS[userId].bets.forEach(b => {
        USERS[userId].credit += b.money;
        ALL_BETS = ALL_BETS.filter(x => x !== b);
      });
      USERS[userId].bets = [];
      return reply(replyToken, "♻ ยกเลิกโพยแล้ว");
    }
    if (text.includes("/")) {
      if (!SYSTEM.OPEN) return reply(replyToken, "❌ ปิดรับแทง");
      const [bet, amt] = text.split("/");
      const money = parseInt(amt);
      USERS[userId] = USERS[userId] || { credit: 0, bets: [] };

      if (money < SYSTEM.MIN || money > SYSTEM.MAX)
        return reply(replyToken, "❌ จำนวนเงินไม่ถูกต้อง");
      if (USERS[userId].credit < money)
        return reply(replyToken, "❌ เครดิตไม่พอ");

      USERS[userId].credit -= money;
      const betData = { userId, bet, money };
      USERS[userId].bets.push(betData);
      ALL_BETS.push(betData);

      // 👉 Flex ใบรับโพย
      return client.replyMessage(replyToken, receiptFlex(userId, bet, money, USERS[userId].credit));
    }
  }

  return reply(replyToken, "❓ คำสั่งไม่ถูกต้อง");
}

/* ===== RESULT + FLEX SUMMARY ===== */
function calcResult(token, result) {
  const summary = {};
  LAST_RESULT = { bets: [...ALL_BETS] };

  ALL_BETS.forEach(b => {
    let net = -b.money;
    if (b.bet === result) {
      net = b.money * (1 + SYSTEM.RATE_WIN / 100);
      USERS[b.userId].credit += net;
    }
    summary[b.userId] = (summary[b.userId] || 0) + net;
  });

  ALL_BETS = [];
  SYSTEM.OPEN = false;

  return client.replyMessage(token, summaryFlex(result, summary));
}

/* ===== FLEX TEMPLATES ===== */
function receiptFlex(uid, bet, money, credit) {
  return {
    type: "flex",
    altText: "RECEIPT",
    contents: {
      type: "bubble",
      styles: { header: { backgroundColor: "#111" }, body: { backgroundColor: "#000" } },
      header: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "text", text: "🧾 ใบรับโพย", color: "#ff3333", weight: "bold", align: "center" }]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: `ผู้เล่น: ${uid.slice(-5)}`, color: "#fff" },
          { type: "text", text: `โพย: ${bet}/${money}`, color: "#fff" },
          { type: "text", text: `เครดิตคงเหลือ: ${credit}`, color: "#00ff88" }
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
      styles: { header: { backgroundColor: "#111" }, body: { backgroundColor: "#000" } },
      header: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "text", text: `🎲 ผลออก: ${result}`, color: "#ff3333", weight: "bold", align: "center" }]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: Object.keys(summary).map(uid => ({
          type: "text",
          text: `• ${uid.slice(-5)} : ${summary[uid] >= 0 ? "+" : ""}${summary[uid]}`,
          color: summary[uid] >= 0 ? "#00ff88" : "#ff5555"
        }))
      }
    }
  };
}

function adminFlex() {
  return {
    type: "flex",
    altText: "ADMIN MENU",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "ADMIN MENU", weight: "bold", size: "lg" },
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
app.listen(PORT, () => console.log("RUNNING", PORT));    });

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
