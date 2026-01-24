const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");

const app = express();

/* ================= ENV ================= */
const LINE_TOKEN = process.env.LINE_TOKEN;
const LINE_SECRET = process.env.LINE_SECRET;
const PORT = process.env.PORT || 3000;

if (!LINE_TOKEN || !LINE_SECRET) {
  console.error("❌ Missing LINE_TOKEN or LINE_SECRET");
  process.exit(1);
}

const client = new line.Client({
  channelAccessToken: LINE_TOKEN,
  channelSecret: LINE_SECRET
});

/* ================= DATABASE ================= */
const FILE = "./data.json";

function load() {
  if (!fs.existsSync(FILE)) {
    return {
      users: {},
      bets: {},
      admins: [],
      config: { open: false }
    };
  }
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

function save(db) {
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

/* ================= FLEX LOADER ================= */
function loadFlex(name, replace = {}) {
  let flex = JSON.parse(fs.readFileSync(`./flex/${name}.json`, "utf8"));
  let txt = JSON.stringify(flex);
  Object.keys(replace).forEach(k => {
    txt = txt.replaceAll(`{{${k}}}`, replace[k]);
  });
  return JSON.parse(txt);
}

/* ================= WEBHOOK ================= */
app.post(
  "/webhook",
  line.middleware({
    channelAccessToken: LINE_TOKEN,
    channelSecret: LINE_SECRET
  }),
  async (req, res) => {
    try {
      const db = load();

      for (const event of req.body.events) {
        if (event.type !== "message") continue;
        if (event.message.type !== "text") continue;

        const rawText = event.message.text.trim();
        const text = rawText.toUpperCase().replace(/＃/g, "#");
        const uid = event.source.userId;
        const gid = event.source.groupId;
        const replyToken = event.replyToken;

        db.users[uid] ??= { credit: 1000 };
        const isAdmin = db.admins.includes(uid);

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

        /* ===== BET : ใบรับโพย ===== */
        if (/^\d+\/\d+$/.test(text)) {
          if (!db.config.open) continue;

          const [num, amt] = text.split("/");
          const amount = parseInt(amt, 10);

          const cut = amount * 3; // หักล่วงหน้า 3 เท่า

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
          save(db);

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

        /* ===== RESULT : S123 ===== */
        if (isAdmin && /^S\d{3}$/.test(text)) {
          const result = text.slice(1);

          db.config.open = false;
          let summary = [];

          Object.keys(db.bets).forEach(u => {
            let total = 0;

            db.bets[u].forEach(b => {
              if (b.num === result) {
                total += b.amount * 1;
              } else if (b.num === "456" && result === "456") {
                total += b.amount * 25;
              } else if (
                /^(111|222|333|444|555|666)$/.test(b.num) &&
                b.num === result
              ) {
                total += b.amount * 100;
              } else {
                total -= b.amount * 3;
              }
            });

            db.users[u].credit += total;
            summary.push(
              `X${u.slice(-4)} : ${total >= 0 ? "+" : ""}${total.toLocaleString()}`
            );
          });

          db.bets = {};
          save(db);

          await client.replyMessage(replyToken, {
            type: "flex",
            altText: `ผลออก ${result}`,
            contents: loadFlex("dice", {
              D1: result[0],
              D2: result[1],
              D3: result[2]
            })
          });

          await client.pushMessage(gid, {
            type: "flex",
            altText: "สรุปยอด",
            contents: loadFlex("summary", {
              RESULT: result,
              LIST: summary.join("\n")
            })
          });
          continue;
        }
      }

      res.sendStatus(200);
    } catch (err) {
      console.error("WEBHOOK ERROR:", err);
      res.sendStatus(200);
    }
  }
);

/* ================= START ================= */
app.listen(PORT, () => {
  console.log("🔥 HILO BOT RUNNING");
});
