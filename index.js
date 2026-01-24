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

// ================= FLEX =================
function receiptFlex(name, code, num, amt, cut, bal) {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: `📄 ใบรับโพย`, weight: "bold", size: "lg" },
        { type: "text", text: `${name} (${code})` },
        { type: "text", text: `เลข ${num} | เดิมพัน ${amt}` },
        { type: "text", text: `หักล่วงหน้า ${cut}`, color: "#dc2626" },
        { type: "text", text: `เครดิตคงเหลือ ${bal}`, color: "#16a34a", weight: "bold" }
      ]
    }
  };
}

function diceImage(n) {
  return {
    type: "image",
    url: `https://raw.githubusercontent.com/kao678/hilo-dice/main/${n}.png`,
    size: "sm",
    aspectMode: "fit"
  };
}

function diceFlexReal(result) {
  const d = result.split("");
  return {
    type: "bubble",
    hero: {
      type: "box",
      layout: "horizontal",
      contents: [diceImage(d[0]), diceImage(d[1]), diceImage(d[2])],
      justifyContent: "center",
      paddingAll: "20px"
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: "🎲 ผลออก", align: "center", weight: "bold" },
        { type: "text", text: result, align: "center", size: "xl", weight: "bold", color: "#2563eb" }
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
        { type: "text", text: "📊 สถิติย้อนหลัง", weight: "bold" },
        ...history.slice(-10).reverse().map((h, i) => ({
          type: "text",
          text: `${i + 1}. ${h.result} (รวม ${h.sum})`
        }))
      ]
    }
  };
}

function summaryFlex(list) {
  if (isAdmin && /^S\d{3}$/.test(text)) {
  const result = text.slice(1);
  db.config.open = false;

  const summaryMap = {};

  Object.keys(db.bets).forEach(uid => {
    summaryMap[uid] = 0;

    db.bets[uid].forEach(b => {
      if (b.num === result) {
        const win = b.amount * 4;
        db.users[uid].credit += win;
        summaryMap[uid] += win;
      } else {
        const lose = b.amount * 3;
        summaryMap[uid] -= lose;
      }
    });
  });

  const summary = Object.keys(summaryMap).map(uid => ({
    name: db.users[uid].name,
    total: summaryMap[uid],
    credit: db.users[uid].credit
  }));

  saveHistory(db, result);
  db.bets = {};
  saveDB(db);

  await client.pushMessage(gid, {
    type: "flex",
    altText: "ปิดบิล",
    contents: closeBillFlex(result, summary)
  });

  return;
  }

// ================= HISTORY =================
function saveHistory(db, result) {
  const sum = result.split("").reduce((a, b) => a + Number(b), 0);
  db.history.push({ result, sum });
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
  db.users[uid] ??= { credit: 1000, name: "NONAME", code: uid.slice(-4) };
  const isAdmin = db.admins.includes(uid);

  // ===== ADMIN =====
  if (text === "#ADMIN") {
    if (!isAdmin) db.admins.push(uid);
    saveDB(db);
    return client.replyMessage(replyToken, { type: "text", text: "✅ คุณเป็นแอดมินแล้ว" });
  }

  if (text === "O" && isAdmin) {
    db.config.open = true;
    saveDB(db);
    return client.replyMessage(replyToken, { type: "text", text: "🟢 เปิดรับเดิมพัน" });
  }

  if (text === "X" && isAdmin) {
    db.config.open = false;
    saveDB(db);
    return client.replyMessage(replyToken, { type: "text", text: "🔴 ปิดรับเดิมพัน" });
  }

  // ===== BET =====
  if (/^\d+\/\d+$/.test(text)) {
    if (!db.config.open) return;
    const [num, amt] = text.split("/");
    const amount = Number(amt);
    const cut = amount * 3;

    if (db.users[uid].credit < cut) {
      return client.replyMessage(replyToken, { type: "text", text: "❌ เครดิตไม่พอ" });
    }

    db.users[uid].credit -= cut;
    db.bets[uid] ??= [];
    db.bets[uid].push({ num, amount });
    saveDB(db);

    return client.replyMessage(replyToken, {
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
  }

// ===== RESULT =====
if (isAdmin && /^S\d{3}$/.test(text)) {
  const result = text.slice(1);
  db.config.open = false;

  const summaryMap = {}; // 👈 เก็บยอดสุทธิแต่ละคน

  Object.keys(db.bets).forEach(u => {
    summaryMap[u] = 0;

    db.bets[u].forEach(b => {
      if (b.num === result) {
        const win = b.amount * 4;
        db.users[u].credit += win;
        summaryMap[u] += win;
      } else {
        const lose = b.amount * 3;
        summaryMap[u] -= lose;
      }
    });
  });

  // 🔥 แปลงเป็น list สำหรับ Flex
  const summary = Object.keys(summaryMap).map(u => ({
    name: db.users[u].name,
    total: summaryMap[u]
  }));

  saveHistory(db, result);
  db.bets = {};
  saveDB(db);

  // 🎲 ผลลูกเต๋า
  await client.pushMessage(gid, {
    type: "flex",
    altText: "ผลออก",
    contents: diceFlexReal(result)
  });

  // 📊 สรุปยอดทั้งห้อง (ที่คุณต้องการ)
  await client.pushMessage(gid, {
    type: "flex",
    altText: "สรุปยอดทั้งห้อง",
    contents: summaryFlex(summary)
  });

  // 📈 สถิติย้อนหลัง
  await client.pushMessage(gid, {
    type: "flex",
    altText: "สถิติย้อนหลัง",
    contents: historyFlex(db.history)
  });

  return;
}

  // ===== C : เช็คยอดเงิน =====
if (text === "C") {
  const user = db.users[uid];

  await client.replyMessage(replyToken, {
    type: "flex",
    altText: "เช็คยอดเงิน",
    contents: balanceFlex(
      user.name || "NONAME",
      user.code || uid.slice(-4),
      user.credit || 0
    )
  });
  return;
}

  // ===== B =====
  if (text === "B") {
    return client.replyMessage(replyToken, {
      type: "text",
      text: `💰 เครดิตคงเหลือ: ${db.users[uid].credit}`
    });
  }
});

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
function balanceFlex(name, code, credit) {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "horizontal",
      spacing: "md",
      contents: [
        {
          type: "image",
          url: "https://i.imgur.com/9XnQZQZ.png", // รูปโปรไฟล์ตัวอย่าง
          size: "sm",
          aspectRatio: "1:1",
          aspectMode: "cover",
          cornerRadius: "50%"
        },
        {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: name,
              weight: "bold",
              color: "#38bdf8",
              size: "md"
            },
            {
              type: "text",
              text: `คงเหลือ ${credit.toLocaleString()} บ.`,
              color: "#22c55e",
              size: "lg",
              weight: "bold"
            },
            {
              type: "text",
              text: `ID: ${code}`,
              color: "#94a3b8",
              size: "sm"
            }
          ]
        }
      ],
      backgroundColor: "#020617",
      paddingAll: "16px",
      cornerRadius: "12px"
    }
  };
}
