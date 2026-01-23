const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");
const { loadDB, saveDB } = require("./database");
const CFG = require("./config");

const app = express();

const client = new line.Client({
  channelAccessToken: CFG.CHANNEL_ACCESS_TOKEN,
  channelSecret: CFG.CHANNEL_SECRET
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

// ===== Webhook =====
app.post(
  "/webhook",
  line.middleware({
    channelAccessToken: CFG.CHANNEL_ACCESS_TOKEN,
    channelSecret: CFG.CHANNEL_SECRET
  }),
  async (req, res) => {
    for (const event of req.body.events) {
      if (event.type !== "message") continue;
      if (event.message.type !== "text") continue;

      const text = event.message.text.trim();
      const replyToken = event.replyToken;
      const userId = event.source.userId;

      let db = loadDB();
      db.users[userId] ??= { credit: 1000 };

      // เปิดรับเดิมพัน
      if (text === "O") {
        db.config.open = true;
        saveDB(db);
        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "เปิดรับเดิมพัน",
          contents: loadFlex("open")
        });
      }

      // ปิดรับเดิมพัน
      if (text === "X") {
        db.config.open = false;
        saveDB(db);
        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "ปิดรับเดิมพัน",
          contents: loadFlex("close")
        });
      }

      // แทง 1/100
      if (/^\d+\/\d+$/.test(text)) {
        if (!db.config.open) {
          return client.replyMessage(replyToken, { type: "text", text: "ยังไม่เปิดรับเดิมพัน" });
        }

        const [num, amt] = text.split("/");
        const amount = parseInt(amt, 10);

        if (amount < db.config.min || amount > db.config.max) {
          return client.replyMessage(replyToken, { type: "text", text: "จำนวนเงินไม่ถูกต้อง" });
        }

        if (db.users[userId].credit < amount) {
          return client.replyMessage(replyToken, { type: "text", text: "เครดิตไม่พอ" });
        }

        db.users[userId].credit -= amount;
        db.bets[userId] ??= [];
        db.bets[userId].push({ num, amount });
        saveDB(db);

        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "รับโพย",
          contents: loadFlex("receipt", {
            NAME: "USER",
            CODE: userId.slice(0, 6),
            NUM: num,
            AMOUNT: amount,
            CUT: amount,
            BAL: db.users[userId].credit
          })
        });
      }

      // ออกผล S123
      if (text.startsWith("S")) {
        const result = text.substring(1);
        let list = [];

        Object.keys(db.bets).forEach(uid => {
          let total = 0;
          db.bets[uid].forEach(b => {
            total += calcWin(b.num, result, b.amount);
          });
          db.users[uid].credit += total;
          list.push(`${uid.slice(0, 6)} : ${total}`);
        });

        db.bets = {};
        saveDB(db);

        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "สรุปยอด",
          contents: loadFlex("summary", { LIST: list.join("\n") || "ไม่มีผู้ชนะ" })
        });
      }

      // ไม่ตรงคำสั่ง
      return client.replyMessage(replyToken, {
        type: "text",
        text: "คำสั่งไม่ถูกต้อง"
      });
    }
    res.sendStatus(200);
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Bot running on port", PORT);
});
