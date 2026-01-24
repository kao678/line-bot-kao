// ================== BASIC SETUP ==================
const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ================== ENV (Render ใส่ให้) ==================
const LINE_TOKEN  = process.env.LINE_TOKEN;
const LINE_SECRET = process.env.LINE_SECRET;

if (!LINE_TOKEN || !LINE_SECRET) {
  console.error("❌ Missing LINE_TOKEN or LINE_SECRET");
  process.exit(1);
}

const client = new line.Client({
  channelAccessToken: LINE_TOKEN
});

// ================== SIMPLE DATABASE ==================
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
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
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

      const text = event.message.text.trim().toUpperCase();
      const uid = event.source.userId;
      const gid = event.source.groupId;
      const replyToken = event.replyToken;

      // init user
      if (!db.users[uid]) {
        db.users[uid] = { credit: 1000 };
      }

      const isAdmin = db.admins.includes(uid);

      // ================== MYID ==================
      if (text === "MYID") {
        await client.replyMessage(replyToken, {
          type: "text",
          text: `MY ID\n${uid}`
        });
        continue;
      }

      // ================== ADMIN TOGGLE ==================
      if (text === "#ADMIN") {
        if (isAdmin) {
          db.admins = db.admins.filter(a => a !== uid);
        } else {
          db.admins.push(uid);
        }
        saveDB(db);
        await client.replyMessage(replyToken, {
          type: "text",
          text: "✅ อัปเดตสิทธิ์แอดมินเรียบร้อย"
        });
        continue;
      }

      // ================== OPEN / CLOSE ==================
      if (isAdmin && text === "O") {
        db.config.open = true;
        saveDB(db);
        await client.replyMessage(replyToken, {
          type: "text",
          text: "🟢 เปิดรับเดิมพันแล้ว"
        });
        continue;
      }

      if (isAdmin && text === "X") {
        db.config.open = false;
        saveDB(db);
        await client.replyMessage(replyToken, {
          type: "text",
          text: "🔴 ปิดรับเดิมพันแล้ว"
        });
        continue;
      }

      // ================== BET 1/100 ==================
      if (/^\d+\/\d+$/.test(text)) {
        if (!db.config.open) {
          await client.replyMessage(replyToken, {
            type: "text",
            text: "❌ ยังไม่เปิดรับเดิมพัน"
          });
          continue;
        }

        const [num, amt] = text.split("/");
        const amount = parseInt(amt, 10);
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
          type: "text",
          text:
            `📄 ใบรับโพย\n` +
            `เลข: ${num}\n` +
            `เดิมพัน: ${amount}\n` +
            `หักล่วงหน้า: ${cut}\n` +
            `คงเหลือ: ${db.users[uid].credit}`
        });
        continue;
      }

      // ================== RESULT S123 ==================
      if (isAdmin && /^S\d{3}$/.test(text)) {
        const result = text.slice(1);
        db.config.open = false;

        let summary = [];

        Object.keys(db.bets).forEach(u => {
          let total = 0;
          db.bets[u].forEach(b => {
            if (b.num === result) {
              total += b.amount * 3;
            }
          });
          db.users[u].credit += total;
          summary.push(`${u.slice(-4)} : +${total}`);
        });

        db.bets = {};
        saveDB(db);

        await client.replyMessage(replyToken, {
          type: "text",
          text:
            `🎲 ผลออก ${result}\n` +
            `📊 สรุปยอด\n` +
            summary.join("\n")
        });
        continue;
      }
    }

    res.sendStatus(200);
  }
);

// ================== HEALTH CHECK ==================
app.get("/", (req, res) => {
  res.send("OK");
});

app.listen(PORT, () => {
  console.log("🚀 Bot running on port", PORT);
});
