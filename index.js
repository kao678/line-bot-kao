const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");

const app = express();

/* ====== CONFIG ====== */
const LINE_TOKEN = process.env.LINE_TOKEN;
const LINE_SECRET = process.env.LINE_SECRET;

if (!LINE_TOKEN || !LINE_SECRET) {
  console.error("❌ Missing LINE_TOKEN or LINE_SECRET");
  process.exit(1);
}

const client = new line.Client({
  channelAccessToken: LINE_TOKEN,
  channelSecret: LINE_SECRET
});

/* ===== SUPER ADMIN ===== */
const SUPER_ADMINS = [
  "Uab107367b6017b2b5fede655841f715c" // 👈 ใส่ USER ID ตัวเอง
];

/* ===== DATABASE ===== */
const FILE = "./data.json";

function load() {
  if (!fs.existsSync(FILE)) {
    return {
      users: {},
      bets: {},
      admins: [],
      config: { open: false, waterLose: 1 },
      history: []
    };
  }
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

function save(db) {
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

/* ===== FLEX ===== */
function loadFlex(name, replace = {}) {
  let flex = JSON.parse(fs.readFileSync(`./flex/${name}.json`, "utf8"));
  let txt = JSON.stringify(flex);
  for (let k in replace) {
    txt = txt.replaceAll(`{{${k}}}`, replace[k]);
  }
  return JSON.parse(txt);
}

/* ===== CALC ===== */
function calcWin(num, result, amt, waterLose) {
  if (num === result) return amt * 1;
  if (num === "456" && result === "456") return amt * 25;
  if (/^(111|222|333|444|555|666)$/.test(num) && num === result)
    return amt * 100;
  return -(amt * 3 + amt * (waterLose / 100));
}

/* ===== WEBHOOK ===== */
app.post(
  "/webhook",
  line.middleware({ channelAccessToken: LINE_TOKEN, channelSecret: LINE_SECRET }),
  async (req, res) => {
    try {
      const db = load();

      for (const event of req.body.events) {
        if (event.type !== "message") continue;
        if (event.message.type !== "text") continue;

        const text = event.message.text.trim().toUpperCase();
        const uid = event.source.userId;
        const gid = event.source.groupId;
        const replyToken = event.replyToken;

        db.users[uid] ??= { credit: 1000, block: false };

        const isSuper = SUPER_ADMINS.includes(uid);
        const isAdmin = isSuper || db.admins.includes(uid);

        /* ===== MYID ===== */
        if (text === "MYID") {
          await client.replyMessage(replyToken, {
            type: "text",
            text: `👤 MY ID\n${uid}\nCODE: X${uid.slice(-5)}`
          });
          continue;
        }

        /* ===== ADD / REMOVE ADMIN (SUPER ONLY) ===== */
        if (isSuper && text.startsWith("ADDADMIN")) {
          const code = text.split(" ")[1];
          if (!code) continue;

          const target = Object.keys(db.users).find(
            u => `X${u.slice(-5)}` === code
          );
          if (target && !db.admins.includes(target)) {
            db.admins.push(target);
            save(db);
          }

          await client.replyMessage(replyToken, {
            type: "text",
            text: "✅ เพิ่มแอดมินย่อยเรียบร้อย"
          });
          continue;
        }

        if (isSuper && text.startsWith("DELADMIN")) {
          const code = text.split(" ")[1];
          const target = Object.keys(db.users).find(
            u => `X${u.slice(-5)}` === code
          );
          db.admins = db.admins.filter(a => a !== target);
          save(db);

          await client.replyMessage(replyToken, {
            type: "text",
            text: "🗑 ลบแอดมินย่อยแล้ว"
          });
          continue;
        }

        /* ===== OPEN / CLOSE ===== */
        if (isAdmin && text === "O") {
          db.config.open = true;
          save(db);
          await client.replyMessage(replyToken, {
            type: "flex",
            altText: "open",
            contents: loadFlex("open")
          });
          continue;
        }

        if (isAdmin && text === "X") {
          db.config.open = false;
          save(db);
          await client.replyMessage(replyToken, {
            type: "flex",
            altText: "close",
            contents: loadFlex("close")
          });
          continue;
        }

        /* ===== BET ===== */
        if (/^\d+\/\d+$/.test(text) && db.config.open) {
          const [num, amt] = text.split("/");
          const amount = parseInt(amt);
          const cost = amount * 3 + amount * (db.config.waterLose / 100);

          if (db.users[uid].credit < cost) continue;

          db.users[uid].credit -= cost;
          db.bets[uid] ??= [];
          db.bets[uid].push({ num, amount });
          save(db);

          await client.replyMessage(replyToken, {
            type: "flex",
            altText: "receipt",
            contents: loadFlex("receipt", {
              NUM: num,
              AMOUNT: amount,
              CUT: cost,
              BAL: db.users[uid].credit
            })
          });
          continue;
        }

        /* ===== RESULT ===== */
        if (isAdmin && /^S\d{3}$/.test(text)) {
          const result = text.slice(1);
          let summary = [];

          for (let u in db.bets) {
            let total = 0;
            for (let b of db.bets[u]) {
              total += calcWin(b.num, result, b.amount, db.config.waterLose);
            }
            db.users[u].credit += total;
            summary.push(`X${u.slice(-5)} : ${total}`);
          }

          db.bets = {};
          save(db);

          await client.replyMessage(replyToken, {
            type: "flex",
            altText: "dice",
            contents: loadFlex("dice")
          });

          await client.pushMessage(gid, {
            type: "flex",
            altText: "summary",
            contents: loadFlex("summary", { LIST: summary.join("\n") })
          });
        }
      }

      res.sendStatus(200);
    } catch (err) {
      console.error(err);
      res.sendStatus(200);
    }
  }
);

app.listen(process.env.PORT || 3000, () =>
  console.log("🔥 HILO BOT RUNNING")
);
