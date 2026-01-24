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
function calcWin(num, result, amount, cfg) {
  let win = 0;
  if (num === result) win = amount;
  if (num === "456" && result === "456") win = amount * 25;
  if (/^(111|222|333|444|555|666)$/.test(num) && num === result)
    win = amount * 100;

  if (win <= 0) return -(amount * 3);
  return win;
}

app.post(
  "/webhook",
  line.middleware({
    channelAccessToken: CFG.LINE_TOKEN,
    channelSecret: CFG.LINE_SECRET
  }),
  async (req, res) => {
    for (const event of req.body.events) {
      if (event.type !== "message") continue;

      const uid = event.source.userId;
      const gid = event.source.groupId;
      const replyToken = event.replyToken;

      let db = load();
      db.users ??= {};
      db.admins ??= [];
      db.bets ??= {};
      db.config ??= { open: false };
      db.users[uid] ??= { credit: 0, name: uid };

      const isAdmin = db.admins.includes(uid);

      if (event.message.type !== "text") continue;
      const text = event.message.text.trim();
      const TEXT = text.toUpperCase();

      /* ================= GLOBAL ================= */
      if (TEXT === "MYID") {
        return client.replyMessage(replyToken, {
          type: "text",
          text:
`👤 MY ID
━━━━━━━━━━━━━━
USER ID:
${uid}

CODE:
X${uid.slice(-5)}`
        });
      }

      if (TEXT === "SETADMINROOM") {
        if (!gid) {
          return client.replyMessage(replyToken, {
            type: "text",
            text: "❌ ใช้ได้เฉพาะในกลุ่ม"
          });
        }
        db.adminRoom = gid;
        if (!db.admins.includes(uid)) db.admins.push(uid);
        save(db);
        return client.replyMessage(replyToken, {
          type: "text",
          text: "✅ ตั้งห้องนี้เป็นห้องแอดมินเรียบร้อย"
        });
      }

      /* ================= ADMIN COMMANDS ================= */
      const isAdminRoom = gid === db.adminRoom;
      const isPlayRoom = gid === CFG.PLAY_GROUP_ID;

      if (isAdmin && (isAdminRoom || isPlayRoom)) {

        if (TEXT === "#ADMIN") {
          if (db.admins.includes(uid))
            db.admins = db.admins.filter(a => a !== uid);
          else
            db.admins.push(uid);
          save(db);
          return client.replyMessage(replyToken, {
            type: "text",
            text: "✅ อัปเดตสิทธิ์แอดมินแล้ว"
          });
        }

        if (TEXT === "O") {
          db.config.open = true;
          save(db);
          return client.replyMessage(replyToken, {
            type: "flex",
            altText: "open",
            contents: loadFlex("open")
          });
        }

        if (TEXT === "X") {
          db.config.open = false;
          save(db);
          return client.replyMessage(replyToken, {
            type: "flex",
            altText: "close",
            contents: loadFlex("close")
          });
        }

        if (/^S\d{3}$/.test(TEXT)) {
          const result = TEXT.slice(1);
          const dice = result.split("");

          let summary = [];
          Object.keys(db.bets).forEach(u => {
            let total = 0;
            db.bets[u].forEach(b => {
              total += calcWin(b.num, result, b.amount, db.config);
            });
            db.users[u].credit += total;
            summary.push(`${db.users[u].name} : ${total >= 0 ? "+" : ""}${total}`);
          });

          db.bets = {};
          save(db);

          await client.replyMessage(replyToken, {
            type: "flex",
            altText: "dice",
            contents: loadFlex("dice", {
              D1: `${CFG.DICE_URL}/${dice[0]}.png`,
              D2: `${CFG.DICE_URL}/${dice[1]}.png`,
              D3: `${CFG.DICE_URL}/${dice[2]}.png`
            })
          });

          return client.pushMessage(CFG.PLAY_GROUP_ID, {
            type: "flex",
            altText: "summary",
            contents: loadFlex("summary", { LIST: summary.join("\n") })
          });
        }
      }

      /* ================= PLAY ROOM ================= */
      if (gid === CFG.PLAY_GROUP_ID && /^\d+\/\d+$/.test(text)) {
        if (!db.config.open) return;

        const [num, amt] = text.split("/");
        const amount = parseInt(amt, 10);
        const cost = amount * 3;

        if (db.users[uid].credit < cost) {
          return client.replyMessage(replyToken, {
            type: "text",
            text: "❌ เครดิตไม่พอ"
          });
        }

        db.users[uid].credit -= cost;
        db.bets[uid] ??= [];
        db.bets[uid].push({ num, amount });
        save(db);

        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "receipt",
          contents: loadFlex("receipt", {
            NAME: db.users[uid].name,
            CODE: `X${uid.slice(-5)}`,
            NUM: num,
            AMOUNT: amount,
            CUT: cost,
            BAL: db.users[uid].credit
          })
        });
      }
    }
    res.sendStatus(200);
  }
);

app.listen(process.env.PORT || 3000, () => {
  console.log("🔥 HILO BOT FINAL RUNNING");
});
