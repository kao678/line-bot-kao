// ================== BASIC SETUP ==================
const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ================== ENV ==================
const LINE_TOKEN = process.env.LINE_TOKEN;
const LINE_SECRET = process.env.LINE_SECRET;

if (!LINE_TOKEN || !LINE_SECRET) {
  console.error("❌ Missing LINE_TOKEN or LINE_SECRET");
  process.exit(1);
}

const client = new line.Client({
  channelAccessToken: LINE_TOKEN
});

// ================== DATABASE ==================
const DB_FILE = "./data.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      users: {},
      admins: [],
      bets: {},
      config: { open: false }
    };
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ================== FLEX LOADER ==================
function loadFlex(name, vars = {}) {
  let json = JSON.parse(fs.readFileSync(`./flex/${name}.json`, "utf8"));
  let str = JSON.stringify(json);
  Object.keys(vars).forEach(k => {
    str = str.replaceAll(`{{${k}}}`, vars[k]);
  });
  return JSON.parse(str);
}

// ================== WEBHOOK ==================
app.post(
  "/webhook",
  line.middleware({ channelSecret: LINE_SECRET }),
  async (req, res) => {
    const db = loadDB();

    for (const event of req.body.events) {
      if (event.type !== "message") continue;
      if (event.message.type !== "text") continue;

      const rawText = event.message.text.trim();
      const text = rawText.toUpperCase();

      const uid = event.source.userId;
      const gid = event.source.groupId;
      const replyToken = event.replyToken;

      db.users[uid] ??= { credit: 1000 };
      const isAdmin = db.admins.includes(uid);

      // ===== MYID =====
      if (text === "MYID") {
        await client.replyMessage(replyToken, {
          type: "text",
          text: `MY ID\n${uid}\nCODE: X${uid.slice(-4)}`
        });
        continue;
      }

      // ===== ADMIN =====
      if (text === "#ADMIN") {
        if (!isAdmin) db.admins.push(uid);
        saveDB(db);
        await client.replyMessage(replyToken, {
          type: "text",
          text: "✅ อัปเดตสิทธิ์แอดมินเรียบร้อย"
        });
        continue;
      }

      // ===== OPEN =====
      if (isAdmin && text === "O") {
        db.config.open = true;
        saveDB(db);
        await client.replyMessage(replyToken, {
          type: "text",
          text: "🟢 เปิดรับเดิมพันแล้ว"
        });
        continue;
      }

      // ===== CLOSE =====
      if (isAdmin && text === "X") {
        db.config.open = false;
        saveDB(db);
        await client.replyMessage(replyToken, {
          type: "text",
          text: "🔴 ปิดรับเดิมพันแล้ว"
        });
        continue;
      }

      // ===== BET 1/100 =====
      if (/^\d+\/\d+$/.test(text)) {
        if (!db.config.open) continue;

        const [num, amt] = text.split("/");
        const amount = parseInt(amt);
        const cut = amount * 3;

        if (db.users[uid].credit < cut) {
          await client.replyMessage(replyToken, {
            type: "text",
            text: "❌ เครดิตไม่พอ"
          });
          continue;
        }

        db.users[uid].credit -= cut;
        db.bets[uid] ??= [];
        db.bets[uid].push({ num, amount });
        saveDB(db);

        await client.replyMessage(replyToken, {
          type: "flex",
          altText: "ใบรับโพย",
          contents: loadFlex("receipt", {
            NUM: num,
            AMOUNT: amount.toLocaleString(),
            CUT: cut.toLocaleString(),
            BAL: db.users[uid].credit.toLocaleString()
          })
        });
        continue;
      }

      // ===== RESULT S123 =====
      if (isAdmin && /^S\d{3}$/.test(text)) {
        const result = text.slice(1);
        db.config.open = false;

        let list = [];
        let house = 0;

        Object.keys(db.bets).forEach(u => {
          let total = 0;
          db.bets[u].forEach(b => {
            if (b.num === result) {
              total += b.amount * 1;
            } else {
              total -= b.amount * 3;
            }
          });
          db.users[u].credit += Math.max(0, total);
          house -= total;

          list.push({
            name: `X${u.slice(-4)}`,
            text: `${b.num} - ${b.amount.toLocaleString()}`,
            result: total
          });
        });

        db.bets = {};
        saveDB(db);

        await client.pushMessage(gid, {
          type: "flex",
          altText: "สรุปเดิมพัน",
          contents: loadFlex("summary", {
            RESULT: result,
            LIST: JSON.stringify(list)
          })
        });

        continue;
      }
    }

    res.sendStatus(200);
  }
);

app.listen(PORT, () => console.log("🚀 Bot running on", PORT));
