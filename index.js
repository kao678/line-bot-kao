// ================= BASIC SETUP =================
const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= ENV =================
const LINE_TOKEN = process.env.LINE_TOKEN;
const LINE_SECRET = process.env.LINE_SECRET;

if (!LINE_TOKEN || !LINE_SECRET) {
  console.error("❌ Missing LINE_TOKEN or LINE_SECRET");
  process.exit(1);
}

const client = new line.Client({
  channelAccessToken: LINE_TOKEN
});

// ================= DATABASE =================
const DB_FILE = "./data.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      users: {},
      admins: [],
      bets: {},
      history: [],
      config: { open: false }
    };
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ================= FLEX HELPERS =================
function diceImage(n) {
  return {
    type: "image",
    url: `https://raw.githubusercontent.com/kao678/hilo-dice/main/${n}.png`,
    size: "sm",
    aspectMode: "fit"
  };
}

// ⭐ ADD : FLEX แสดงเครดิต (เหมือนรูป)
function creditCardFlex(user) {
  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#020617",
      paddingAll: "16px",
      contents: [
        {
          type: "text",
          text: user.code,
          color: "#38bdf8",
          size: "lg",
          weight: "bold"
        },
        {
          type: "text",
          text: `คงเหลือ ${user.credit.toLocaleString()} บ.`,
          color: "#22c55e",
          size: "xl",
          weight: "bold",
          margin: "sm"
        },
        {
          type: "text",
          text: `ID: x${user.code}`,
          color: "#94a3b8",
          size: "sm",
          margin: "sm"
        }
      ]
    }
  };
}

function closeBillFlex(result, summary) {
  const totalRoom = summary.reduce((a, b) => a + b.total, 0);

  return {
    type: "bubble",
    size: "giga",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#020617",
      paddingAll: "14px",
      contents: [
        {
          type: "text",
          text: "🎲 ปิดบิลผลออก",
          align: "center",
          size: "lg",
          weight: "bold",
          color: "#38bdf8"
        },
        {
          type: "text",
          text: result,
          align: "center",
          size: "xxl",
          weight: "bold",
          color: "#ffffff"
        }
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: summary.map((u, i) => ({
        type: "box",
        layout: "vertical",
        spacing: "xs",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: `${i + 1}. ${u.name}`,
                flex: 4,
                size: "sm",
                wrap: true
              },
              {
                type: "text",
                text:
                  (u.total > 0 ? "+" : "") +
                  u.total.toLocaleString(),
                flex: 2,
                size: "sm",
                align: "end",
                weight: "bold",
                color: u.total >= 0 ? "#22c55e" : "#ef4444"
              }
            ]
          },
          {
            type: "text",
            text: `เครดิตคงเหลือ ${u.credit.toLocaleString()} บ.`,
            size: "xs",
            color: "#64748b"
          },
          {
            type: "separator",
            margin: "sm"
          }
        ]
      }))
    },
    footer: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#020617",
      paddingAll: "14px",
      contents: [
        {
          type: "text",
          text: "💰 รวมยอดทั้งห้อง",
          align: "center",
          size: "sm",
          color: "#94a3b8"
        },
        {
          type: "text",
          text:
            (totalRoom > 0 ? "+" : "") +
            totalRoom.toLocaleString() +
            " บาท",
          align: "center",
          size: "xl",
          weight: "bold",
          color: totalRoom >= 0 ? "#22c55e" : "#ef4444"
        }
      ]
    }
  };
}

// ================= HISTORY =================
function saveHistory(db, result) {
  const sum = result.split("").reduce((a, b) => a + Number(b), 0);
  db.history.push({ result, sum, time: new Date().toLocaleString("th-TH") });
  if (db.history.length > 20) db.history.shift();
}

// ================= WEBHOOK =================
app.post(
  "/webhook",
  line.middleware({ channelSecret: LINE_SECRET }),
  async (req, res) => {
    res.sendStatus(200);

    const event = req.body.events[0];
    if (!event || event.type !== "message") return;

    const text = event.message.text.trim();
    const uid = event.source.userId;
    const gid = event.source.groupId;
    const replyToken = event.replyToken;

    const db = loadDB();

    if (!db.users[uid]) {
      db.users[uid] = {
        credit: 1000,
        name: `USER-${uid.slice(-4)}`,
        code: uid.slice(-4)
      };
    }

    const isAdmin = db.admins.includes(uid);

    // ===== ADMIN =====
    if (text === "#ADMIN") {
      if (!isAdmin) db.admins.push(uid);
      saveDB(db);
      return client.replyMessage(replyToken, {
        type: "text",
        text: "✅ ได้สิทธิ์แอดมินแล้ว"
      });
    }

    if (text === "O" && isAdmin) {
      db.config.open = true;
      saveDB(db);
      return client.replyMessage(replyToken, {
        type: "text",
        text: "🟢 เปิดรับเดิมพัน"
      });
    }

    if (text === "X" && isAdmin) {
      db.config.open = false;
      saveDB(db);
      return client.replyMessage(replyToken, {
        type: "text",
        text: "🔴 ปิดรับเดิมพัน"
      });
    }

    // ⭐ ADD : C = สรุปเครดิต
    if (text === "C" && isAdmin) {
      const bubbles = Object.values(db.users).map(u =>
        creditCardFlex(u)
      );

      return client.pushMessage(gid, {
        type: "flex",
        altText: "สรุปเครดิต",
        contents: {
          type: "carousel",
          contents: bubbles
        }
      });
    }

    // ===== BET =====
    if (/^\d+\/\d+$/.test(text)) {
      if (!db.config.open) return;

      const [num, amt] = text.split("/");
      const amount = parseInt(amt, 10);
      const cut = amount * 3;

      if (db.users[uid].credit < cut) {
        return client.replyMessage(replyToken, {
          type: "text",
          text: "❌ เครดิตไม่พอ"
        });
      }

      db.users[uid].credit -= cut;
      db.bets[uid] ??= [];
      db.bets[uid].push({ num, amount });
      saveDB(db);

      return client.replyMessage(replyToken, {
        type: "text",
        text: `รับโพย ${num}/${amount}`
      });
    }

    // ===== RESULT =====
    if (isAdmin && /^S\d{3}$/.test(text)) {
      const result = text.slice(1);
      db.config.open = false;

      const summaryMap = {};

      Object.keys(db.bets).forEach(uid2 => {
        summaryMap[uid2] = 0;

        db.bets[uid2].forEach(b => {
          if (b.num === result) {
            const win = b.amount * 4;
            db.users[uid2].credit += win;
            summaryMap[uid2] += win;
          } else {
            summaryMap[uid2] -= b.amount * 3;
          }
        });
      });

      const summary = Object.keys(summaryMap).map(uid2 => ({
        name: db.users[uid2].name,
        total: summaryMap[uid2],
        credit: db.users[uid2].credit
      }));

      saveHistory(db, result);
      db.bets = {};
      saveDB(db);

      await client.pushMessage(gid, {
        type: "flex",
        altText: "ปิดบิล",
        contents: closeBillFlex(result, summary)
      });
    }
  }
);

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
