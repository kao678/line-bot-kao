const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");

const app = express();

/* ================= CONFIG ================= */
const client = new line.Client({
  channelAccessToken: process.env.LINE_TOKEN,
  channelSecret: process.env.LINE_SECRET
});

/* ================= DATABASE ================= */
const FILE = "./data.json";

function load() {
  if (!fs.existsSync(FILE)) {
    return {
      users: {},
      bets: {},
      admins: [],
      config: {
        open: false,
        waterLose: 1
      },
      history: []
    };
  }
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

function save(db) {
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

/* ================= FLEX ================= */
function loadFlex(name, replace = {}) {
  let flex = JSON.parse(fs.readFileSync(`./flex/${name}.json`, "utf8"));
  let txt = JSON.stringify(flex);
  Object.keys(replace).forEach(k => {
    txt = txt.replaceAll(`{{${k}}}`, replace[k]);
  });
  return JSON.parse(txt);
}

/* ================= CALC ================= */
function calcWin(num, result, amt, waterLose) {
  if (num === result) return amt * 1;
  if (num === "456" && result === "456") return amt * 25;
  if (/^(111|222|333|444|555|666)$/.test(num) && num === result) return amt * 100;
  return -(amt * 3 + amt * (waterLose / 100));
}

/* ================= WEBHOOK ================= */
app.post(
  "/webhook",
  line.middleware({
    channelAccessToken: process.env.LINE_TOKEN,
    channelSecret: process.env.LINE_SECRET
  }),
  async (req, res) => {
    try {
      const db = load();
      db.history ??= [];

      for (const event of req.body.events) {
        if (event.type !== "message") continue;
        if (event.message.type !== "text") continue;

        const text = event.message.text.trim().toUpperCase();
        const uid = event.source.userId;
        const gid = event.source.groupId;
        const replyToken = event.replyToken;

        db.users[uid] ??= { credit: 1000, block: false };
        const isAdmin = db.admins.includes(uid);

        /* ===== MYID ===== */
        if (text === "MYID") {
          await client.replyMessage(replyToken, {
            type: "text",
            text: `👤 MY ID\n${uid}\nCODE: X${uid.slice(-5)}`
          });
          continue;
        }

        /* ===== ADMIN TOGGLE ===== */
        if (text === "#ADMIN") {
          if (isAdmin) {
            db.admins = db.admins.filter(a => a !== uid);
          } else {
            db.admins.push(uid);
          }
          save(db);
          await client.replyMessage(replyToken, {
            type: "text",
            text: "✅ อัปเดตสิทธิ์แอดมินแล้ว"
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

        /* ===== RESET / REFUND ===== */
        if (isAdmin && (text === "RESET" || text === "REFUND")) {
          Object.keys(db.bets).forEach(u => {
            db.bets[u].forEach(b => {
              db.users[u].credit += b.amount * 3;
            });
          });
          db.bets = {};
          save(db);
          await client.replyMessage(replyToken, {
            type: "flex",
            altText: "refund",
            contents: loadFlex("refund")
          });
          continue;
        }

        /* ===== BET ===== */
        if (/^\d+\/\d+$/.test(text)) {
          if (!db.config.open) continue;
          if (db.users[uid].block) continue;

          const [num, amt] = text.split("/");
          const amount = parseInt(amt, 10);
          const cost = amount * 3 + amount * (db.config.waterLose / 100);

          if (db.users[uid].credit < cost) {
            await client.replyMessage(replyToken, {
              type: "text",
              text: "❌ เครดิตไม่พอ"
            });
            continue;
          }

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
          const dice = result.split("");
          let summary = [];

          Object.keys(db.bets).forEach(u => {
            let total = 0;
            db.bets[u].forEach(b => {
              total += calcWin(b.num, result, b.amount, db.config.waterLose);
            });
            db.users[u].credit += total;
            summary.push(`X${u.slice(-5)} : ${total >= 0 ? "+" : ""}${total}`);
          });

          db.history.push({ result, summary, time: Date.now() });
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
    } catch (e) {
      console.error("WEBHOOK ERROR:", e);
      res.sendStatus(200);
    }
  }
);

app.listen(process.env.PORT || 3000, () => {
  console.log("🔥 HILO BOT RUNNING");
});
