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
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ================= FLEX HELPERS =================
function receiptFlex(name, code, num, amt, cut, bal) {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: `${name} (${code})`, weight: "bold" },
        { type: "text", text: `${num} - ${amt} ✅`, color: "#2563eb" },
        { type: "text", text: `หักล่วงหน้า ${cut}`, color: "#dc2626" },
        { type: "text", text: `คงเหลือ ${bal}`, color: "#16a34a", weight: "bold" }
      ]
    }
  };
}

function diceFlex(result) {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: `🎲 ผลออก ${result}`, weight: "bold", size: "lg" },
        {
          type: "box",
          layout: "horizontal",
          contents: result.split("").map(n => ({
            type: "image",
            url: `https://raw.githubusercontent.com/kao678/hilo-dice/main/${n}.png`,
            size: "sm"
          }))
        }
      ]
    }
  };
}

function historyFlex(history) {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: "📊 สถิติย้อนหลัง", weight: "bold", size: "lg" },
        ...history.slice(-10).reverse().map((h, i) => ({
          type: "text",
          text: `${i + 1}. ${h.result} → ${h.sum}`,
          color: h.sum >= 11 ? "#16a34a" : "#dc2626"
        }))
      ]
    }
  };
}

// ================= HISTORY =================
function saveHistory(db, result) {
  const sum = result.split("").reduce((a, b) => a + Number(b), 0);
  db.history.push({
    result,
    sum,
    time: new Date().toLocaleString("th-TH")
  });
  if (db.history.length > 20) db.history.shift();
}

// ================= WEBHOOK =================
app.post("/webhook", line.middleware({ channelSecret: LINE_SECRET }), async (req, res) => {
  res.sendStatus(200);

  const event = req.body.events[0];
  if (!event || event.type !== "message") return;

  const text = event.message.text.trim();
  const uid = event.source.userId;
  const gid = event.source.groupId;
  const replyToken = event.replyToken;

  const db = loadDB();

  if (!db.users[uid]) {
    db.users[uid] = { credit: 1000, name: "NONAME", code: uid.slice(-4) };
  }

  const isAdmin = db.admins.includes(uid);

  // ===== ADMIN =====
  if (text === "#ADMIN") {
    if (!db.admins.includes(uid)) db.admins.push(uid);
    saveDB(db);
    await client.replyMessage(replyToken, { type: "text", text: "✅ อัปเดตสิทธิ์แอดมินเรียบร้อย" });
    return;
  }

  if (text === "O" && isAdmin) {
    db.config.open = true;
    saveDB(db);
    await client.replyMessage(replyToken, { type: "text", text: "🟢 เปิดรับเดิมพันแล้ว" });
    return;
  }

  if (text === "X" && isAdmin) {
    db.config.open = false;
    saveDB(db);
    await client.replyMessage(replyToken, { type: "text", text: "🔴 ปิดรับเดิมพันแล้ว" });
    return;
  }

  // ===== BET =====
  if (/^\d+\/\d+$/.test(text)) {
    if (!db.config.open) return;

    const [num, amt] = text.split("/");
    const amount = parseInt(amt);
    const cut = amount * 3;

    if (db.users[uid].credit < cut) {
      await client.replyMessage(replyToken, { type: "text", text: "❌ เครดิตไม่พอ" });
      return;
    }

    db.users[uid].credit -= cut;
    db.bets[uid] ??= [];
    db.bets[uid].push({ num, amount });

    saveDB(db);

    await client.replyMessage(replyToken, {
      type: "flex",
      altText: "ใบรับโพย",
      contents: receiptFlex(
        db.users[uid].name,
        db.users[uid].code,
        num,
        amount,
        cut,
        db.users[uid].credit
      )
    });
    return;
  }

  // ===== RESULT =====
  if (isAdmin && /^S\d{3}$/.test(text)) {
    const result = text.slice(1);
    db.config.open = false;

    Object.keys(db.bets).forEach(u => {
      db.bets[u].forEach(b => {
        if (b.num === result) {
          db.users[u].credit += b.amount;
        } else {
          db.users[u].credit -= b.amount * 3;
        }
      });
    });

    saveHistory(db, result);
    db.bets = {};
    saveDB(db);

    await client.pushMessage(gid, {
  type: "flex",
  altText: "ผลออก",
  contents: diceFlexReal(result)
});

await client.pushMessage(gid, {
  type: "flex",
  altText: "สรุปยอดเดิมพัน",
  contents: summaryFlex(summary)
});

await client.pushMessage(gid, {
  type: "flex",
  altText: "สถิติย้อนหลัง",
  contents: historyFlex(db.history)
});

  // ===== C =====
  if (text === "C") {
    await client.replyMessage(replyToken, {
      type: "flex",
      altText: "สถิติย้อนหลัง",
      contents: historyFlex(db.history || [])
    });
    return;
  }
});

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
function diceImage(n) {
  return {
    type: "image",
    url: `https://raw.githubusercontent.com/kao678/hilo-dice/main/${n}.png`,
    size: "sm",
    aspectMode: "fit"
  };
}

function diceFlexReal(result) {
  const dice = result.split("");

  return {
    type: "bubble",
    hero: {
      type: "box",
      layout: "horizontal",
      spacing: "md",
      contents: [
        diceImage(dice[0]),
        diceImage(dice[1]),
        diceImage(dice[2])
      ],
      justifyContent: "center",
      alignItems: "center",
      paddingAll: "20px"
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "🎲 ผลออก",
          weight: "bold",
          align: "center",
          size: "lg"
        },
        {
          type: "text",
          text: result,
          align: "center",
          size: "xl",
          weight: "bold",
          color: "#2563eb"
        }
      ]
    }
  };
}
function summaryFlex(summaryList) {
  return {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "📊 สรุปยอดเดิมพัน",
          weight: "bold",
          size: "lg",
          align: "center",
          color: "#ffffff"
        }
      ],
      backgroundColor: "#111827",
      paddingAll: "12px"
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: summaryList.length
        ? summaryList.map(item => ({
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: item.name,
                flex: 3,
                size: "sm",
                wrap: true
              },
              {
                type: "text",
                text:
                  (item.total > 0 ? "+" : "") +
                  item.total.toLocaleString(),
                flex: 2,
                size: "sm",
                align: "end",
                weight: "bold",
                color: item.total >= 0 ? "#16a34a" : "#dc2626"
              }
            ]
          }))
        : [
            {
              type: "text",
              text: "ไม่มีการเดิมพัน",
              align: "center",
              color: "#6b7280"
            }
          ]
    }
  };
}
