const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");
const { load, save } = require("./database");
const CFG = require("./config");

const app = express();
const client = new line.Client({
  channelAccessToken: CFG.LINE_TOKEN,
  channelSecret: CFG.LINE_SECRET
});

// ===== โหลด Flex =====
function loadFlex(name, replace = {}) {
  let flex = JSON.parse(fs.readFileSync(`./flex/${name}.json`, "utf8"));
  let txt = JSON.stringify(flex);
  Object.keys(replace).forEach(k => {
    txt = txt.replaceAll(`{{${k}}}`, replace[k]);
  });
  return JSON.parse(txt);
}

// ===== คำนวณผล =====
function calcWin(num, result, amount) {
  if (num === result) return amount * 1;
  if (num === "456" && result === "456") return amount * 25;
  if (/^(111|222|333|444|555|666)$/.test(num) && num === result) {
    return amount * 100;
  }
  return 0;
}

app.post(
  "/webhook",
  line.middleware({ channelAccessToken: CFG.LINE_TOKEN, channelSecret: CFG.LINE_SECRET }),
  async (req, res) => {
    for (const event of req.body.events) {
      if (event.type !== "message" || event.message.type !== "text") continue;

      const text = event.message.text.trim();
      const uid = event.source.userId;
      const replyToken = event.replyToken;

      let db = load();
      db.users[uid] ??= { credit: 1000, block: false };
      const isAdmin = db.admins.includes(uid);

      // ===== แอดมิน =====
      if (text === "#ADMIN") {
        if (isAdmin) db.admins = db.admins.filter(a => a !== uid);
        else db.admins.push(uid);
        save(db);
        return client.replyMessage(replyToken, { type: "text", text: "อัปเดตสิทธิ์แอดมินแล้ว" });
      }

      if (isAdmin && text === "O") {
        db.config.open = true; save(db);
        return client.replyMessage(replyToken, { type: "flex", altText: "open", contents: loadFlex("open") });
      }

      if (isAdmin && text === "X") {
        db.config.open = false; save(db);
        return client.replyMessage(replyToken, { type: "flex", altText: "close", contents: loadFlex("close") });
      }

      if (isAdmin && text === "RESET") {
        db.bets = {}; db.round++; save(db);
        return client.replyMessage(replyToken, { type: "text", text: "รีรอบเรียบร้อย" });
      }

      if (isAdmin && text === "REFUND") {
        Object.keys(db.bets).forEach(u => {
          db.bets[u].forEach(b => db.users[u].credit += b.amount * 3);
        });
        db.bets = {}; save(db);
        return client.replyMessage(replyToken, { type: "flex", altText: "refund", contents: loadFlex("refund") });
      }

      if (isAdmin && text === "BACK") {
        return client.replyMessage(replyToken, { type: "flex", altText: "back", contents: loadFlex("back") });
      }

      // ===== ตั้งค่าน้ำ =====
      if (isAdmin && /^N\/\d+(\.\d+)?$/.test(text)) {
        db.config.waterLose = parseFloat(text.split("/")[1]); save(db);
        return client.replyMessage(replyToken, { type: "text", text: `ตั้งค่าน้ำเสีย ${db.config.waterLose}%` });
      }

      if (isAdmin && /^NC\/\d+(\.\d+)?$/.test(text)) {
        db.config.waterWin = parseFloat(text.split("/")[1]); save(db);
        return client.replyMessage(replyToken, { type: "text", text: `ตั้งค่าน้ำได้ ${db.config.waterWin}%` });
      }

      if (isAdmin && /^#KNP\/\d+$/.test(text)) {
        const r = parseInt(text.split("/")[1], 10);
        if (!db.config.freeWaterRounds.includes(r)) db.config.freeWaterRounds.push(r);
        save(db);
        return client.replyMessage(replyToken, { type: "text", text: `ฟรีค่าน้ำเปิดที่ ${r}` });
      }

      // ===== แทง =====
      if (/^\d+\/\d+$/.test(text)) {
        if (!db.config.open) return;
        const [num, amt] = text.split("/");
        const amount = parseInt(amt, 10);
        const cut = amount * 3;

        if (amount < db.config.min || amount > db.config.max) return;
        if (db.users[uid].credit < cut) return;

        db.users[uid].credit -= cut;
        db.bets[uid] ??= [];
        db.bets[uid].push({ num, amount });
        db.daily.in += cut;
        save(db);

        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "receipt",
          contents: loadFlex("receipt", {
            NAME: "KimmiK",
            CODE: uid.slice(0, 6),
            NUM: num,
            AMOUNT: cut,
            CUT: cut,
            BAL: db.users[uid].credit
          })
        });
      }

      // ===== ออกผล =====
      if (isAdmin && text.startsWith("S")) {
        const result = text.slice(1);
        const isFree = db.config.freeWaterRounds.includes(db.round);
        let list = [];

        Object.keys(db.bets).forEach(u => {
          let win = 0, betSum = 0;
          db.bets[u].forEach(b => {
            betSum += b.amount;
            win += calcWin(b.num, result, b.amount);
          });

          if (!isFree) {
            if (win > 0 && db.config.waterWin > 0) win -= win * (db.config.waterWin / 100);
            if (win === 0 && db.config.waterLose > 0) db.users[u].credit -= betSum * (db.config.waterLose / 100);
          }

          db.users[u].credit += Math.max(0, win);
          db.daily.out += Math.max(0, win);
          list.push(`${u.slice(0,6)} : ${db.users[u].credit}`);
        });

        db.bets = {}; db.round++; save(db);

        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "summary",
          contents: loadFlex("summary", { LIST: list.join("\n") || "ไม่มีผู้ชนะ" })
        });
      }

      // ===== ปิดบ้านรายวัน =====
      if (isAdmin && text === "CSD") {
        const rep = `สรุปวันนี้\nรับเข้า: ${db.daily.in}\nจ่ายออก: ${db.daily.out}`;
        db.daily = { in: 0, out: 0 };
        save(db);
        return client.replyMessage(replyToken, { type: "text", text: rep });
      }
    }
    res.sendStatus(200);
  }
);

app.listen(process.env.PORT || 3000);
