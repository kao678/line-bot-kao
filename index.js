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
      lastResult: null
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
  if (/^(111|222|333|444|555|666)$/.test(num) && num === result)
    return amt * 100;
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

      for (const event of req.body.events) {
        if (event.type !== "message") continue;
        if (event.message.type !== "text") continue;

        const text = event.message.text.trim().toUpperCase();
        const uid = event.source.userId;
        const gid = event.source.groupId;
        const replyToken = event.replyToken;

        db.users[uid] ??= {
          credit: 1000,
          code: "X" + uid.slice(-4),
          name: "สมาชิก",
          block: false
        };

        const isAdmin = db.admins.includes(uid);
        const user = db.users[uid];

        /* ===== BLOCK ===== */
        if (user.block) continue;

        /* ===== MYID ===== */
        if (text === "MYID") {
          await client.replyMessage(replyToken, {
            type: "text",
            text:
              `👤 MY ID\n\n` +
              `USER ID:\n${uid}\n\n` +
              `CODE:\n${user.code}`
          });
          continue;
        }

        /* ===== ADMIN TOGGLE ===== */
        if (text === "#ADMIN") {
          if (isAdmin) db.admins = db.admins.filter(a => a !== uid);
          else db.admins.push(uid);
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

        /* ===== ADD / SUB CREDIT ===== */
        if (isAdmin && /^X\d{4}[+-]\d+$/.test(text)) {
          const code = text.slice(0, 5);
          const sign = text[5];
          const amt = parseInt(text.slice(6));

          const targetId = Object.keys(db.users).find(
            u => db.users[u].code === code
          );
          if (!targetId) continue;

          if (sign === "+") db.users[targetId].credit += amt;
          else db.users[targetId].credit -= amt;

          save(db);
          await client.replyMessage(replyToken, {
            type: "text",
            text:
              `คุณ ${db.users[targetId].name}\n` +
              `${sign}${amt.toLocaleString()} บ.\n` +
              `คงเหลือ ${db.users[targetId].credit.toLocaleString()} บ.`
          });
          continue;
        }

        /* ===== BLOCK USER ===== */
        if (isAdmin && /^BLOCK\/X\d{4}$/.test(text)) {
          const code = text.split("/")[1];
          const targetId = Object.keys(db.users).find(
            u => db.users[u].code === code
          );
          if (!targetId) continue;

          db.users[targetId].block = !db.users[targetId].block;
          save(db);
          await client.replyMessage(replyToken, {
            type: "text",
            text: db.users[targetId].block
              ? `⛔ บล็อค ${code} แล้ว`
              : `✅ ปลดบล็อค ${code} แล้ว`
          });
          continue;
        }

        /* ===== BET ===== */
        if (/^\d+\/\d+$/.test(text) && db.config.open) {
          const [num, amt] = text.split("/");
          const amount = parseInt(amt);
          const cost = amount * 3;

          if (user.credit < cost) continue;

          user.credit -= cost;
          db.bets[uid] ??= [];
          db.bets[uid].push({ num, amount });
          save(db);

          await client.replyMessage(replyToken, {
            type: "flex",
            altText: "receipt",
            contents: loadFlex("receipt", {
              NAME: user.name,
              CODE: user.code,
              NUM: num,
              AMOUNT: amount,
              CUT: cost,
              BAL: user.credit
            })
          });
          continue;
        }

        /* ===== RESULT ===== */
        if (isAdmin && /^S\d{3}$/.test(text)) {
          const result = text.slice(1);
          db.lastResult = result;

          let summary = [];
          Object.keys(db.bets).forEach(u => {
            let total = 0;
            db.bets[u].forEach(b => {
              total += calcWin(
                b.num,
                result,
                b.amount,
                db.config.waterLose
              );
            });
            db.users[u].credit += total;
            summary.push(
              `${db.users[u].name} (${db.users[u].code}) : ${total}`
            );
          });

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
            contents: loadFlex("summary", {
              LIST: summary.join("\n")
            })
          });
        }

        /* ===== RESET / REFUND ===== */
        if (isAdmin && ["RESET", "REFUND", "BACK"].includes(text)) {
          db.bets = {};
          save(db);
          await client.replyMessage(replyToken, {
            type: "flex",
            altText: "reset",
            contents: loadFlex("back")
          });
        }
      }
      res.sendStatus(200);
    } catch (e) {
      console.error(e);
      res.sendStatus(200);
    }
  }
);

app.listen(process.env.PORT || 3000, () =>
  console.log("🔥 HILO BOT RUNNING")
);
