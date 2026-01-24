require("dotenv").config();
const express = require("express");
const fs = require("fs");
const line = require("@line/bot-sdk");

const app = express();
const PORT = process.env.PORT || 3000;

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

/* ================== DATABASE ================== */
const DB_FILE = "./data.json";
function load() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      users: {},
      bets: {},
      admins: [],
      config: { open: false },
      history: []
    };
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}
function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/* ================== FLEX ================== */
function loadFlex(name, data = {}) {
  let flex = JSON.parse(fs.readFileSync(`./flex/${name}.json`));
  let txt = JSON.stringify(flex);
  Object.keys(data).forEach(k => {
    txt = txt.replace(new RegExp(`{{${k}}}`, "g"), data[k]);
  });
  return JSON.parse(txt);
}

/* ================== WEBHOOK ================== */
app.post(
  "/webhook",
  line.middleware({ channelAccessToken: LINE_TOKEN, channelSecret: LINE_SECRET }),
  async (req, res) => {
    const db = load();

    for (const event of req.body.events) {
      if (event.type !== "message") continue;
      if (event.message.type !== "text") continue;

      const raw = event.message.text.trim();
      const text = raw.toUpperCase();
      const uid = event.source.userId;
      const gid = event.source.groupId;
      const replyToken = event.replyToken;

      db.users[uid] ??= { credit: 1000, name: "NONAME" };
      const isAdmin = db.admins.includes(uid);

      /* ===== MYID ===== */
      if (text === "MYID") {
        await client.replyMessage(replyToken, {
          type: "text",
          text: `MY ID\n${uid}\nCODE: X${uid.slice(-4)}`
        });
        continue;
      }

      /* ===== ADMIN TOGGLE ===== */
      if (text === "#ADMIN") {
        if (!db.admins.includes(uid)) db.admins.push(uid);
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

      /* ===== BET 1/100 ===== */
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

        save(db);

        await client.replyMessage(replyToken, {
          type: "flex",
          altText: "receipt",
          contents: loadFlex("receipt", {
            NAME: db.users[uid].name,
            CODE: `X${uid.slice(-4)}`,
            BET: `${num} - ${amount.toLocaleString()}`,
            CUT: cut.toLocaleString(),
            BAL: db.users[uid].credit.toLocaleString()
          })
        });
        continue;
      }

      /* ===== RESULT S123 ===== */
      if (isAdmin && /^S\d{3}$/.test(text)) {
        const result = text.slice(1);
        db.config.open = false;

        let summary = [];
        let history = {
          round: db.history.length + 1,
          result,
          players: []
        };

        Object.keys(db.bets).forEach(u => {
          let total = 0;
          db.bets[u].forEach(b => {
            if (b.num === result) total += b.amount;
            else total -= b.amount * 3;
          });
          db.users[u].credit += total;
          history.players.push({
            name: `X${u.slice(-4)}`,
            diff: total
          });
          summary.push(
            `${u.slice(-4)} : ${total >= 0 ? "+" : ""}${total.toLocaleString()}`
          );
        });

        db.history.unshift(history);
        if (db.history.length > 10) db.history.pop();

        db.bets = {};
        save(db);

        await client.replyMessage(replyToken, {
          type: "flex",
          altText: "dice",
          contents: loadFlex("dice", {
            D1: result[0],
            D2: result[1],
            D3: result[2]
          })
        });

        await client.pushMessage(gid, {
          type: "flex",
          altText: "summary",
          contents: loadFlex("summary", {
            RESULT: result,
            LIST: summary.join("\n")
          })
        });

        await client.pushMessage(gid, {
          type: "flex",
          altText: "history",
          contents: loadFlex("history", {
            HISTORY: db.history
              .map(h => `#${h.round} → ${h.result}`)
              .join("\n")
          })
        });
      }
    }
    res.sendStatus(200);
  }
);

app.listen(PORT, () => console.log("🚀 Bot running"));
