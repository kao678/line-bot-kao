const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");

const app = express();

/* ================= ENV CHECK ================= */
if (!process.env.LINE_TOKEN || !process.env.LINE_SECRET) {
  console.error("❌ Missing LINE_TOKEN or LINE_SECRET");
  process.exit(1);
}

/* ================= LINE CLIENT ================= */
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
      admins: {
        super: [], // แอดมินใหญ่
        sub: []    // แอดมินย่อย
      },
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

      for (const event of req.body.events) {
        if (event.type !== "message") continue;
        if (event.message.type !== "text") continue;

        const rawText = event.message.text.trim();
        const text = rawText.toUpperCase().replace(/＃/g, "#");
        const uid = event.source.userId;
        const gid = event.source.groupId;
        const replyToken = event.replyToken;

        db.users[uid] ??= { credit: 1000, block: false };

        const isSuperAdmin = db.admins.super.includes(uid);
        const isSubAdmin = db.admins.sub.includes(uid);
        const isAdmin = isSuperAdmin || isSubAdmin;

        /* ===== MYID ===== */
        if (text === "MYID") {
          await client.replyMessage(replyToken, {
            type: "text",
            text: `👤 MY ID\n${uid}\nCODE: X${uid.slice(-4)}`
          });
          continue;
        }

        /* ===== ตั้งแอดมินใหญ่ (ทำครั้งแรกครั้งเดียว) ===== */
        if (text === "SETSUPER") {
          if (db.admins.super.length > 0) continue;
          db.admins.super.push(uid);
          save(db);
          await client.replyMessage(replyToken, {
            type: "text",
            text: "👑 ตั้งคุณเป็นแอดมินใหญ่เรียบร้อย"
          });
          continue;
        }

        /* ===== เพิ่ม / ลบ แอดมินย่อย (SUPER เท่านั้น) ===== */
        if (isSuperAdmin && text.startsWith("ADDADMIN")) {
          const code = text.split(" ")[1];
          if (!code) continue;

          const target = Object.keys(db.users).find(
            u => `X${u.slice(-4)}` === code
          );
          if (target && !db.admins.sub.includes(target)) {
            db.admins.sub.push(target);
            save(db);
          }

          await client.replyMessage(replyToken, {
            type: "text",
            text: "✅ เพิ่มแอดมินย่อยแล้ว"
          });
          continue;
        }

        if (isSuperAdmin && text.startsWith("DELADMIN")) {
          const code = text.split(" ")[1];
          const target = Object.keys(db.users).find(
            u => `X${u.slice(-4)}` === code
          );
          db.admins.sub = db.admins.sub.filter(a => a !== target);
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
        if (/^\d+\/\d+$/.test(text)) {
          if (!db.config.open || db.users[uid].block) continue;

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
            altText: "ใบรับโพย",
            contents: loadFlex("receipt", {
              NAME: "NONAME",
              CODE: "X" + uid.slice(-4),
              NUM: num,
              AMOUNT: amount.toLocaleString(),
              CUT: cost.toLocaleString(),
              BAL: db.users[uid].credit.toLocaleString()
            })
          });
          continue;
        }

        /* ===== C : CHECK CREDIT & BETS (FLEX) ===== */
        if (text === "C") {
          const myBets = db.bets[uid] || [];

          let betListText = "ยังไม่มีการเดิมพัน";
          if (myBets.length > 0) {
            betListText = myBets
              .map(b => `• ${b.num} / ${b.amount.toLocaleString()}`)
              .join("\n");
          }

          await client.replyMessage(replyToken, {
            type: "flex",
            altText: "เช็คยอด",
            contents: loadFlex("check", {
              BET_LIST: betListText,
              BAL: db.users[uid].credit.toLocaleString()
            })
          });
          continue;
        }

        /* ===== DL : DELETE ALL MY BETS ===== */
        if (text === "DL") {
          const myBets = db.bets[uid] || [];
          if (myBets.length === 0) continue;

          let refund = 0;
          myBets.forEach(b => {
            refund += b.amount * 3 + b.amount * (db.config.waterLose / 100);
          });

          db.users[uid].credit += refund;
          delete db.bets[uid];
          save(db);

          await client.replyMessage(replyToken, {
            type: "text",
            text:
              `♻️ ยกเลิกโพยเรียบร้อย\n` +
              `คืนเครดิต ${refund.toLocaleString()}\n` +
              `💳 คงเหลือ ${db.users[uid].credit.toLocaleString()}`
          });
          continue;
        }

        /* ===== RESULT ===== */
        if (isAdmin && /^S\d{3}$/.test(text)) {
          const result = text.slice(1);
          let summary = [];

          Object.keys(db.bets).forEach(u => {
            let total = 0;
            db.bets[u].forEach(b => {
              total += calcWin(b.num, result, b.amount, db.config.waterLose);
            });
            db.users[u].credit += total;
            summary.push(`X${u.slice(-4)} : ${total >= 0 ? "+" : ""}${total}`);
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
