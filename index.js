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
  if (/^(111|222|333|444|555|666)$/.test(num) && num === result)
    return amount * 100;
  return 0;
}

app.post(
  "/webhook",
  line.middleware({
    channelAccessToken: CFG.LINE_TOKEN,
    channelSecret: CFG.LINE_SECRET
  }),
  async (req, res) => {
    for (const event of req.body.events) {
      if (event.type !== "message" || event.message.type !== "text") continue;

      const text = event.message.text.trim();
      const uid = event.source.userId;
      const replyToken = event.replyToken;
      const gid = event.source.groupId;

      let db = load();
      db.users[uid] ??= { credit: 1000, name: uid, block: false };
      const isAdmin = db.admins.includes(uid);

      // ===== แอดมิน =====
      if (text === "#ADMIN") {
        if (isAdmin) db.admins = db.admins.filter(a => a !== uid);
        else db.admins.push(uid);
        save(db);
        return client.replyMessage(replyToken, {
          type: "text",
          text: "อัปเดตสิทธิ์แอดมินแล้ว"
        });
      }

      if (isAdmin && text === "O") {
        db.config.open = true;
        save(db);
        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "เปิดรับเดิมพัน",
          contents: loadFlex("open")
        });
      }

      if (isAdmin && text === "X") {
        db.config.open = false;
        save(db);
        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "ปิดรับเดิมพัน",
          contents: loadFlex("close")
        });
      }

      // ===== แทง =====
      if (/^\d+\/\d+$/.test(text)) {
        if (!db.config.open)
          return client.replyMessage(replyToken, { type: "text", text: "❌ ปิดรับแทง" });

        const [num, amt] = text.split("/");
        const amount = parseInt(amt);

        if (amount < db.config.min || amount > db.config.max)
          return client.replyMessage(replyToken, { type: "text", text: "❌ ยอดแทงไม่ถูกต้อง" });

        const cost = amount * 3;
        if (db.users[uid].credit < cost)
          return client.replyMessage(replyToken, { type: "text", text: "❌ เครดิตไม่พอ" });

        db.users[uid].credit -= cost;
        db.bets[uid] ??= [];
        db.bets[uid].push({ num, amount });
        save(db);

        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "รับโพย",
          contents: loadFlex("receipt", {
            NAME: db.users[uid].name,
            BET: `${num} - ${cost}`,
            LEFT: db.users[uid].credit
          })
        });
      }

      // ===== ออกผล =====
      if (isAdmin && /^S\d{3}$/.test(text)) {
        const result = text.slice(1);
        const dice = result.split("");

        db.config.open = false;
        let summary = [];

        Object.keys(db.bets).forEach(u => {
          let total = 0;
          db.bets[u].forEach(b => {
            total += calcWin(b.num, result, b.amount) - b.amount;
          });
          db.users[u].credit += total;
          summary.push(`${db.users[u].name} : ${total >= 0 ? "+" : ""}${total}`);
        });

        db.lastResult = { result, bets: db.bets };
        db.bets = {};
        save(db);

        await client.replyMessage(replyToken, {
          type: "flex",
          altText: "ผลออก",
          contents: loadFlex("dice", {
            D1: dice[0],
            D2: dice[1],
            D3: dice[2]
          })
        });

        return client.pushMessage(gid || uid, {
          type: "flex",
          altText: "สรุป",
          contents: loadFlex("summary", {
            LIST: summary.join("\n")
          })
        });
      }

      // ===== BACK =====
      if (isAdmin && text === "BACK") {
        if (!db.lastResult)
          return client.replyMessage(replyToken, { type: "text", text: "❌ ไม่มีผลให้ย้อน" });

        Object.keys(db.lastResult.bets).forEach(u => {
          db.lastResult.bets[u].forEach(b => {
            const win = calcWin(b.num, db.lastResult.result, b.amount);
            db.users[u].credit -= win - b.amount;
          });
        });

        db.lastResult = null;
        save(db);
        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "ย้อนผล",
          contents: loadFlex("back")
        });
      }

      // ===== RESET =====
      if (isAdmin && (text === "RESET" || text === "รีรอบ")) {
        db.bets = {};
        db.config.open = false;
        save(db);
        return client.replyMessage(replyToken, {
          type: "text",
          text: "รีเซ็ตระบบเรียบร้อย"
        });
      }
    }
    res.sendStatus(200);
  }
);

app.listen(process.env.PORT || 3000);
