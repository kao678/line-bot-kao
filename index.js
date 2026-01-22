require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

/* ===== LINE CONFIG ===== */
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};
const client = new line.Client(config);

/* ===== ADMIN ===== */
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",");

/* ===== ROOMS (AUTO SAVE) ===== */
let PLAY_ROOM_ID = null;
let DEPOSIT_ROOM_ID = null;

/* ===== SYSTEM ===== */
let SYSTEM = {
  OPEN: false,
  MIN: 10,
  MAX: 50000
};

/* ===== DATA ===== */
let USERS = {};   // userId => { credit, bets, blocked }
let ALL_BETS = [];

/* ===== WEBHOOK ===== */
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (e) {
    console.error("WEBHOOK ERROR:", e);
    res.status(200).end(); // ❗ สำคัญ ป้องกัน 500
  }
});

/* ===== HELPERS ===== */
const isAdmin = uid => ADMIN_IDS.includes(uid);
const initUser = uid => {
  if (!USERS[uid]) USERS[uid] = { credit: 0, bets: [], blocked: false };
};

/* ===== DICE LOGIC ===== */
function diceToResult(d1, d2, d3) {
  const arr = [d1, d2, d3].sort().join("");
  const sum = d1 + d2 + d3;

  if (arr === "123") return { special: "123" };
  if (d1 === d2 && d2 === d3) return { special: "555" };

  if (sum <= 6) return { page: "1" };
  if (sum <= 10) return { page: "2" };
  if (sum <= 14) return { page: "3" };
  return { page: "4" };
}

/* ===== CALC ===== */
function calcBet(bet, result) {
  if (bet.type === "123" && result.special === "123") return bet.money * 25;
  if (bet.type === "555" && result.special === "555") return bet.money * 100;
  if (bet.type === result.page) return bet.money * 3;
  return -bet.money;
}

/* ===== HANDLER ===== */
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text.trim();
  const userId = event.source.userId;
  const roomId = event.source.groupId || event.source.roomId || null;
  const replyToken = event.replyToken;

  initUser(userId);

  /* ===== AUTO SAVE ROOM ===== */
  if (isAdmin(userId)) {
    if (text === "O") PLAY_ROOM_ID = roomId;
    if (text.startsWith("N/")) DEPOSIT_ROOM_ID = roomId;
  }

  /* ===== ADMIN : PLAY ROOM ===== */
  if (roomId === PLAY_ROOM_ID && isAdmin(userId)) {

    if (text === "O") {
      SYSTEM.OPEN = true;
      return client.replyMessage(replyToken, { type: "text", text: "🟢 เปิดรับเดิมพัน" });
    }

    if (text === "X") {
      SYSTEM.OPEN = false;
      return client.replyMessage(replyToken, { type: "text", text: "🔴 ปิดรับเดิมพัน" });
    }

    if (text.startsWith("S")) {
      const [d1, d2, d3] = text.substring(1).split("").map(Number);
      const result = diceToResult(d1, d2, d3);

      let summary = [];
      ALL_BETS.forEach(b => {
        const net = calcBet(b, result);
        USERS[b.userId].credit += net;
        summary.push({
          uid: b.userId.slice(-4),
          net
        });
      });

      ALL_BETS = [];
      SYSTEM.OPEN = false;

      return client.replyMessage(replyToken, summaryFlex(result, summary));
    }
  }

  /* ===== ADMIN : DEPOSIT ROOM ===== */
  if (roomId === DEPOSIT_ROOM_ID && isAdmin(userId)) {

    if (text.match(/^X\w+\+\d+/)) {
      const [uid, amt] = text.split("+");
      initUser(uid);
      USERS[uid].credit += Number(amt);
      return client.replyMessage(replyToken, { type: "text", text: `➕ เติม ${amt}` });
    }

    if (text.match(/^X\w+-\d+/)) {
      const [uid, amt] = text.split("-");
      initUser(uid);
      USERS[uid].credit -= Number(amt);
      return client.replyMessage(replyToken, { type: "text", text: `➖ ถอน ${amt}` });
    }
  }

  /* ===== USER : PLAY ===== */
  if (roomId === PLAY_ROOM_ID) {

    if (text === "C") {
      return client.replyMessage(replyToken, {
        type: "text",
        text: `💰 เครดิตคงเหลือ ${USERS[userId].credit}`
      });
    }

    if (text.includes("/")) {
      if (!SYSTEM.OPEN) return;

      const [type, amt] = text.split("/");
      const money = Number(amt);
      if (money < SYSTEM.MIN || money > SYSTEM.MAX) return;

      if (USERS[userId].credit < money) return;

      USERS[userId].credit -= money;
      const bet = { userId, type, money };
      USERS[userId].bets.push(bet);
      ALL_BETS.push(bet);

      return client.replyMessage(replyToken, receiptFlex(userId, type, money, USERS[userId].credit));
    }
  }
}

/* ===== FLEX ===== */
function receiptFlex(uid, type, money, credit) {
  return {
    type: "flex",
    altText: "ใบรับโพย",
    contents: {
      type: "bubble",
      styles: { body: { backgroundColor: "#000000" } },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "🧾 ใบรับโพย", color: "#ff3333", weight: "bold" },
          { type: "text", text: `ID: ${uid.slice(-4)}`, color: "#ffffff" },
          { type: "text", text: `แทง: ${type} / ${money}`, color: "#ffffff" },
          { type: "text", text: `คงเหลือ: ${credit}`, color: "#00ff88" }
        ]
      }
    }
  };
}

function summaryFlex(result, list) {
  return {
    type: "flex",
    altText: "สรุปผล",
    contents: {
      type: "bubble",
      styles: { body: { backgroundColor: "#000000" } },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: result.special
              ? `🎯 สเปเชียล ${result.special}`
              : `🎲 ผลออก ${result.page}`,
            color: "#ff3333",
            weight: "bold"
          },
          ...list.map(i => ({
            type: "text",
            text: `${i.uid} ${i.net > 0 ? "+" : ""}${i.net}`,
            color: i.net > 0 ? "#00ff88" : "#ff5555"
          }))
        ]
      }
    }
  };
}

/* ===== START ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("BOT RUNNING", PORT));
