const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");
const { load, save } = require("./database");
const CFG = require("./config");

const app = express();
const client = new line.Client({
  channelAccessToken: CFG.LINE_TOKEN,
  channelSecret: CFG.LINE_SECRET
});

// ===== โหลด Flex =====
function loadFlex(name, replace = {}) {
  let flex = JSON.parse(fs.readFileSync(`./flex/${name}.json`, "utf8"));
  let txt = JSON.stringify(flex);
  Object.keys(replace).forEach(k => {
    txt = txt.replaceAll(`{{${k}}}`, replace[k]);
  });
  return JSON.parse(txt);
}

// ===== คำนวณผล =====
function calcWin(num, result, amount, cfg, isFreeWater) {
  let win = 0;
  if (num === result) win = amount * 1;
  if (num === "456" && result === "456") win = amount * 25;
  if (/^(111|222|333|444|555|666)$/.test(num) && num === result) win = amount * 100;

  if (win <= 0) {
    let lose = amount * 3;
    if (!isFreeWater && cfg.waterLose > 0) lose += amount * (cfg.waterLose / 100);
    return -lose;
  }
  let profit = win;
  if (!isFreeWater && cfg.waterWin > 0) profit -= win * (cfg.waterWin / 100);
  return profit;
}

app.post(
  "/webhook",
  line.middleware({ channelAccessToken: CFG.LINE_TOKEN, channelSecret: CFG.LINE_SECRET }),
  async (req, res) => {
    for (const event of req.body.events) {
      if (event.type !== "message") continue;

      const gid = event.source.groupId;
      const uid = event.source.userId;
      let db = load();
      db.users[uid] ??= { credit: 0, name: uid, block: false };
      const isAdmin = db.admins.includes(uid);

      // ===== รับรูปสลิป (ห้องฝากเท่านั้น) =====
      if (event.message.type === "image" && gid === CFG.DEPOSIT_GROUP_ID) {
        const slipId = `SLIP-${Date.now()}`;
        db.slips[slipId] = {
          uid,
          imageId: event.message.id,
          status: "PENDING"
        };
        save(db);

        // แจ้งแอดมิน
        await client.pushMessage(CFG.ADMIN_GROUP_ID, {
          type: "text",
          text: `📥 มีสลิปใหม่\nID: ${slipId}\nผู้ใช้: ${uid}\nพิมพ์:\nOK ${slipId} 1000\nหรือ\nNO ${slipId}`
        });

        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "📨 รับสลิปแล้ว รอแอดมินตรวจสอบ"
        });
      }

      if (event.message.type !== "text") continue;
      const text = event.message.text.trim();
      const replyToken = event.replyToken;

      // ===== ADMIN ROOM =====
      if (gid === CFG.ADMIN_GROUP_ID) {
        if (text === "#ADMIN") {
          if (isAdmin) db.admins = db.admins.filter(a => a !== uid);
          else db.admins.push(uid);
          save(db);
          return client.replyMessage(replyToken, { type: "text", text: "อัปเดตสิทธิ์แอดมินแล้ว" });
        }

        // อนุมัติสลิป
        if (isAdmin && /^OK\s+SLIP-\d+\s+\d+$/.test(text)) {
          const [_, slipId, amt] = text.split(/\s+/);
          const slip = db.slips[slipId];
          if (!slip || slip.status !== "PENDING")
            return client.replyMessage(replyToken, { type: "text", text: "❌ ไม่พบสลิป" });

          db.users[slip.uid].credit += parseInt(amt, 10);
          slip.status = "APPROVED";
          save(db);

          await client.pushMessage(slip.uid, {
            type: "text",
            text: `✅ เติมเครดิตสำเร็จ ${amt} บาท`
          });
          return client.replyMessage(replyToken, { type: "text", text: "อนุมัติแล้ว" });
        }

        // ปฏิเสธสลิป
        if (isAdmin && /^NO\s+SLIP-\d+$/.test(text)) {
          const slipId = text.split(" ")[1];
          if (db.slips[slipId]) db.slips[slipId].status = "REJECTED";
          save(db);
          return client.replyMessage(replyToken, { type: "text", text: "ปฏิเสธสลิปแล้ว" });
        }
      }

      // ===== PLAY ROOM =====
      if (gid === CFG.PLAY_GROUP_ID) {
        if (isAdmin && text === "O") {
          db.config.open = true; save(db);
          return client.replyMessage(replyToken, { type: "flex", altText: "open", contents: loadFlex("open") });
        }
        if (isAdmin && text === "X") {
          db.config.open = false; save(db);
          return client.replyMessage(replyToken, { type: "flex", altText: "close", contents: loadFlex("close") });
        }

        // แทง
        if (/^\d+\/\d+$/.test(text)) {
          if (!db.config.open) return;
          const [num, amt] = text.split("/");
          const amount = parseInt(amt, 10);
          const cost = amount * 3;
          if (db.users[uid].credit < cost) return;

          db.users[uid].credit -= cost;
          db.bets[uid] ??= [];
          db.bets[uid].push({ num, amount });
          save(db);

          return client.replyMessage(replyToken, {
            type: "flex",
            altText: "receipt",
            contents: loadFlex("receipt", {
              NAME: db.users[uid].name,
              CODE: uid.slice(0,6),
              NUM: num,
              AMOUNT: cost,
              CUT: cost,
              BAL: db.users[uid].credit
            })
          });
        }

        // ออกผล
        if (isAdmin && /^S\d{3}$/.test(text)) {
          const result = text.slice(1);
          const dice = result.split("");
          const isFreeWater = db.config.freeWaterRounds.includes(db.round);

          let summary = [];
          Object.keys(db.bets).forEach(u => {
            let total = 0;
            db.bets[u].forEach(b => total += calcWin(b.num, result, b.amount, db.config, isFreeWater));
            db.users[u].credit += total;
            summary.push(`${db.users[u].name} : ${total >= 0 ? "+" : ""}${total}`);
          });

          db.bets = {};
          db.round++;
          save(db);

          await client.replyMessage(replyToken, {
            type: "flex",
            altText: "dice",
            contents: loadFlex("dice", {
              D1: `${CFG.DICE_URL}/${dice[0]}.png`,
              D2: `${CFG.DICE_URL}/${dice[1]}.png`,
              D3: `${CFG.DICE_URL}/${dice[2]}.png`
            })
          });

          return client.pushMessage(CFG.PLAY_GROUP_ID, {
            type: "flex",
            altText: "summary",
            contents: loadFlex("summary", { LIST: summary.join("\n") })
          });
        }
      }
    }
    res.sendStatus(200);
  }
);

app.listen(process.env.PORT || 3000);
