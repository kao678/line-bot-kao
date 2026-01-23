const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");
const { loadDB, saveDB } = require("./database");
const CFG = require("./config");

const app = express();

const client = new line.Client({
  channelAccessToken: CFG.CHANNEL_ACCESS_TOKEN,
  channelSecret: CFG.CHANNEL_SECRET
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

// ===== Webhook =====
app.post(
  "/webhook",
  line.middleware({
    channelAccessToken: CFG.CHANNEL_ACCESS_TOKEN,
    channelSecret: CFG.CHANNEL_SECRET
  }),
  async (req, res) => {
    for (const event of req.body.events) {
      if (event.type !== "message") continue;
      if (event.message.type !== "text") continue;

      const text = event.message.text.trim();
      const replyToken = event.replyToken;

      // เปิดรับเดิมพัน
      if (text === "O") {
        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "เปิดรับเดิมพัน",
          contents: loadFlex("open")
        });
      }

      // ปิดรับเดิมพัน
      if (text === "X") {
        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "ปิดรับเดิมพัน",
          contents: loadFlex("close")
        });
      }

      // ออกผล
      if (text.startsWith("S")) {
        const result = text.substring(1);
        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "ผลการออก",
          contents: loadFlex("dice", { RESULT: result })
        });
      }

      // ข้อความอื่น
      return client.replyMessage(replyToken, {
        type: "text",
        text: "คำสั่งไม่ถูกต้อง"
      });
    }
    res.sendStatus(200);
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Bot running on port", PORT);
});
