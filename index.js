require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");

const app = express();
app.use(express.json());

// ================= CONFIG =================
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);

// ================= ADMIN =================
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",");

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.send("LINE BOT IS RUNNING ✅");
});

// ================= WEBHOOK =================
app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => {
      console.error("WEBHOOK ERROR:", err);
      res.status(200).end(); // สำคัญมาก กัน LINE 500
    });
});

// ================= HANDLER =================
function handleEvent(event) {
  if (event.type !== "message") {
    return Promise.resolve(null);
  }
  if (event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const text = event.message.text.trim();
  const replyToken = event.replyToken;

  // ---------- ADMIN CHECK ----------
  const userId = event.source.userId;
  const isAdmin = ADMIN_IDS.includes(userId);

  // ---------- BET FORMAT ----------
  // 1/100 , 2/100 , 3/100 , 4/100
  const betMatch = text.match(/^([1-4])\/(\d+)$/);

  // 123/20 , 555/20
  const specialMatch = text.match(/^(123|555)\/(\d+)$/);

  let replyText = "";

  if (betMatch) {
    const face = betMatch[1];
    const amount = parseInt(betMatch[2]);

    const map = {
      "1": "⬜ แทง 1 (ขาว)",
      "2": "🟩 แทง 2 (เขียว)",
      "3": "🟨 แทง 3 (เหลือง)",
      "4": "🟥 แทง 4 (แดง)",
    };

    replyText =
      `${map[face]}\n` +
      `💰 เงินเดิมพัน: ${amount.toLocaleString()} บาท\n` +
      `✅ รับโพยเรียบร้อย`;

  } else if (specialMatch) {
    const type = specialMatch[1];
    const amount = parseInt(specialMatch[2]);

    if (type === "123") {
      replyText =
        `🎯 แทงสเปรย์ 123\n` +
        `💰 เงินเดิมพัน: ${amount.toLocaleString()} บาท\n` +
        `💵 อัตราจ่าย: 25 ต่อ\n` +
        `✅ รับโพยเรียบร้อย`;
    }

    if (type === "555") {
      replyText =
        `💨 แทงเป่า 555\n` +
        `💰 เงินเดิมพัน: ${amount.toLocaleString()} บาท\n` +
        `💵 อัตราจ่าย: 100 ต่อ\n` +
        `✅ รับโพยเรียบร้อย`;
    }

  } else if (text === "ADMIN" && isAdmin) {
    replyText =
      `👑 ADMIN MODE\n` +
      `🆔 ${userId}`;

  } else {
    replyText =
      `📌 รูปแบบการแทง\n` +
      `1/100 = แทง 1 (ขาว)\n` +
      `2/100 = แทง 2 (เขียว)\n` +
      `3/100 = แทง 3 (เหลือง)\n` +
      `4/100 = แทง 4 (แดง)\n\n` +
      `123/20 = สเปรย์ (จ่าย 25 ต่อ)\n` +
      `555/20 = เป่า (จ่าย 100 ต่อ)\n\n` +
      `🕒 เปิดบริการ 24 ชม.`;
  }

  return client.replyMessage(replyToken, {
    type: "text",
    text: replyText,
  });
}

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
