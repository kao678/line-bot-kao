require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

/* ===== CONFIG ===== */
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);

const ADMIN_ID = process.env.ADMIN_ID;
const PLAY_ROOM_ID = process.env.PLAY_ROOM_ID;
const DEPOSIT_ROOM_ID = process.env.DEPOSIT_ROOM_ID;

/* ===== SYSTEM ===== */
let SYSTEM = { OPEN: false };
let USERS = {};      // { userId: { bets: [] } }
let ALL_BETS = [];   // [{ userId, type, bet, money }]
let CREDITS = {};    // { userId: number }
let DEPOSITS = {};   // { depositId: { userId, amount, status } }
let HISTORY = [];    // logs

/* ===== WEBHOOK ===== */
app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

/* ===== HANDLER ===== */
async function handleEvent(event) {
  if (event.type !== "message") return null;
  if (event.message.type !== "text") return null;

  const text = event.message.text.trim();
  const userId = event.source.userId;
  const token = event.replyToken;
  const roomId = event.source.groupId || event.source.roomId || "PRIVATE";

  /* ===== DEBUG ROOM ID ===== */
  if (text === "ROOM") {
    return reply(token, `ROOM_ID:\n${roomId}`);
  }

  /* ===================== ADMIN MENU ===================== */
  if (text === "MENU") {
    if (userId !== ADMIN_ID) return reply(token, "⛔ แอดมินเท่านั้น");
    return replyFlexMenu(token);
  }

  if (text === "ID") {
    if (userId !== ADMIN_ID) return reply(token, "⛔ แอดมินเท่านั้น");
    return reply(token, `🆔 ADMIN ID:\n${userId}`);
  }

  /* ===================== DEPOSIT ROOM ===================== */
  if (roomId === DEPOSIT_ROOM_ID) {
    // ลูกแจ้งฝาก: ฝาก 1000
    if (text.startsWith("ฝาก")) {
      const amt = parseInt(text.split(" ")[1]);
      if (isNaN(amt) || amt <= 0) return reply(token, "❌ ใช้: ฝาก 1000");

      const depId = `D${Date.now()}`;
      DEPOSITS[depId] = { userId, amount: amt, status: "PENDING" };
      HISTORY.push({ type: "DEPOSIT_REQ", userId, amt, depId, at: Date.now() });

      // แจ้งแอดมินพร้อมปุ่ม
      await client.pushMessage(ADMIN_ID, depositApproveFlex(depId, userId, amt));
      return reply(token, "📨 แจ้งฝากแล้ว รอแอดมินอนุมัติ");
    }
  }

  /* ===================== ADMIN ACTIONS ===================== */
  // อนุมัติ/ปฏิเสธ (พิมพ์คำสั่งจากปุ่ม)
  if (text.startsWith("APPROVE")) {
    if (userId !== ADMIN_ID) return reply(token, "⛔ แอดมินเท่านั้น");
    const depId = text.split(" ")[1];
    const dep = DEPOSITS[depId];
    if (!dep || dep.status !== "PENDING") return reply(token, "❌ ไม่พบรายการ");

    dep.status = "APPROVED";
    CREDITS[dep.userId] = (CREDITS[dep.userId] || 0) + dep.amount;
    HISTORY.push({ type: "DEPOSIT_OK", ...dep, at: Date.now() });

    await client.pushMessage(dep.userId, {
      type: "text",
      text: `✅ เติมเครดิตสำเร็จ +${dep.amount}\nคงเหลือ: ${CREDITS[dep.userId]}`
    });
    return reply(token, `✔ อนุมัติ ${depId} แล้ว`);
  }

  if (text.startsWith("REJECT")) {
    if (userId !== ADMIN_ID) return reply(token, "⛔ แอดมินเท่านั้น");
    const depId = text.split(" ")[1];
    const dep = DEPOSITS[depId];
    if (!dep || dep.status !== "PENDING") return reply(token, "❌ ไม่พบรายการ");

    dep.status = "REJECTED";
    HISTORY.push({ type: "DEPOSIT_NO", ...dep, at: Date.now() });
    await client.pushMessage(dep.userId, {
      type: "text",
      text: `❌ การฝาก ${dep.amount} ถูกปฏิเสธ`
    });
    return reply(token, `✖ ปฏิเสธ ${depId}`);
  }

  /* ===================== PLAY ROOM ===================== */
  if (roomId === PLAY_ROOM_ID) {
    // ADMIN ONLY
    if (text === "O") {
      if (userId !== ADMIN_ID) return reply(token, "⛔ แอดมินเท่านั้น");
      SYSTEM.OPEN = true;
      return replyFlex(token, "🟢 เปิดรับแทง", ["ระบบเปิดแล้ว"]);
    }

    if (text === "CLOSE") {
      if (userId !== ADMIN_ID) return reply(token, "⛔ แอดมินเท่านั้น");
      SYSTEM.OPEN = false;
      return replyFlex(token, "🔴 ปิดรับแทง", ["ระบบปิดแล้ว"]);
    }

    if (text.startsWith("RESULT")) {
      if (userId !== ADMIN_ID) return reply(token, "⛔ แอดมินเท่านั้น");
      const result = text.split(" ")[1];
      if (!result) return reply(token, "❌ ใช้: RESULT 1 / RESULT 123");
      if (ALL_BETS.length === 0) return reply(token, "⚠️ ไม่มีโพยในรอบนี้");

      const summary = calcSummaryByUser(result);
      const lines = [];
      Object.keys(summary).forEach(uid => {
        const amt = summary[uid];
        const sign = amt >= 0 ? "+" : "";
        CREDITS[uid] = (CREDITS[uid] || 0) + amt;
        lines.push(`• ${uid.slice(-5)} : ${sign}${amt} | คงเหลือ ${CREDITS[uid]}`);
      });

      HISTORY.push({ type: "RESULT", result, summary, at: Date.now() });

      USERS = {};
      ALL_BETS = [];
      SYSTEM.OPEN = false;

      return replyFlex(token, `🎲 ผลออก: ${result}`, lines);
    }

    // USER
    if (text === "CREDIT") {
      return reply(token, `💳 เครดิตคงเหลือ: ${CREDITS[userId] || 0}`);
    }

    if (text === "DL") {
      if (!USERS[userId]) return reply(token, "❌ ไม่มีโพย");
      USERS[userId].bets.forEach(b => {
        ALL_BETS = ALL_BETS.filter(x => x !== b);
        CREDITS[userId] += b.money;
      });
      USERS[userId].bets = [];
      return reply(token, "♻ ยกเลิกโพยแล้ว");
    }

    if (text.includes("/")) {
      if (!SYSTEM.OPEN) return reply(token, "❌ ปิดรับแทง");

      const [betRaw, amtRaw] = text.split("/");
      const bet = betRaw.trim();
      const money = parseInt(amtRaw);
      if (isNaN(money) || money <= 0) return reply(token, "❌ รูปแบบแทงไม่ถูกต้อง");

      if (!CREDITS[userId]) CREDITS[userId] = 0;
      if (CREDITS[userId] < money) return reply(token, "❌ เครดิตไม่พอ");

      let type = "SINGLE";
      if (bet.length === 3 && new Set(bet).size === 3) type = "SPRAY";
      if (/^(\d)\1\1$/.test(bet)) type = "BLOW";

      if (!USERS[userId]) USERS[userId] = { bets: [] };
      const betData = { userId, type, bet, money };
      USERS[userId].bets.push(betData);
      ALL_BETS.push(betData);
      CREDITS[userId] -= money;
      HISTORY.push({ type: "BET", userId, bet, money, at: Date.now() });

      return replyFlex(
        token,
        "🎯 รับโพยแล้ว",
        [`โพย: ${bet}/${money}`, `เครดิตคงเหลือ: ${CREDITS[userId]}`]
      );
    }
  }

  return reply(token, "❓ คำสั่งไม่ถูกต้อง");
}

/* ===== CALC ===== */
function calcSummaryByUser(result) {
  const out = {};
  ALL_BETS.forEach(b => {
    let net = 0;
    if (b.type === "SINGLE") net = b.bet === result ? b.money : -b.money;
    if (b.type === "SPRAY")
      net = (result.length === 1 && b.bet.includes(result)) ? b.money * 25 : -b.money;
    if (b.type === "BLOW")
      net = (result.length === 1 && b.bet[0] === result) ? b.money * 100 : -b.money;
    out[b.userId] = (out[b.userId] || 0) + net;
  });
  return out;
}

/* ===== FLEX ===== */
function replyFlex(token, title, lines) {
  return client.replyMessage(token, {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      styles: { header: { backgroundColor: "#111" }, body: { backgroundColor: "#000" } },
      header: { type: "box", layout: "vertical", contents: [
        { type: "text", text: title, color: "#ff3333", weight: "bold", align: "center", size: "lg" }
      ]},
      body: { type: "box", layout: "vertical", spacing: "sm",
        contents: lines.map(t => ({ type: "text", text: t, color: "#fff" }))
      }
    }
  });
}

function replyFlexMenu(token) {
  return client.replyMessage(token, {
    type: "flex",
    altText: "ADMIN MENU",
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", contents: [
        { type: "text", text: "ADMIN MENU", color: "#ff3333", weight: "bold", align: "center" }
      ]},
      body: { type: "box", layout: "vertical", spacing: "md", contents: [
        { type: "button", action: { type: "message", label: "ดู ID แอดมิน", text: "ID" } },
        { type: "button", action: { type: "message", label: "เปิดรับแทง", text: "O" } },
        { type: "button", action: { type: "message", label: "ปิดรับแทง", text: "CLOSE" } },
      ]}
    }
  });
}

function depositApproveFlex(depId, uid, amt) {
  return {
    type: "flex",
    altText: "DEPOSIT APPROVAL",
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", contents: [
        { type: "text", text: "📥 แจ้งฝาก", weight: "bold", color: "#ff3333" }
      ]},
      body: { type: "box", layout: "vertical", spacing: "sm", contents: [
        { type: "text", text: `ผู้ใช้: ${uid.slice(-5)}` },
        { type: "text", text: `ยอด: ${amt}` },
        { type: "button", style: "primary",
          action: { type: "message", label: "อนุมัติ", text: `APPROVE ${depId}` } },
        { type: "button", style: "secondary",
          action: { type: "message", label: "ปฏิเสธ", text: `REJECT ${depId}` } },
      ]}
    }
  };
}

/* ===== TEXT ===== */
function reply(token, text) {
  return client.replyMessage(token, { type: "text", text });
}

/* ===== START ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("RUNNING ON PORT", PORT));
