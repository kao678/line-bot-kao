const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

/* ===== LINE CONFIG ===== */
const config = {
  channelAccessToken: process.env.LINE_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};

const client = new line.Client(config);

/* ===== SYSTEM STATE ===== */
let SYSTEM = {
  OPEN: false,
};

let USERS = {};      // { userId: { bets: [] } }
let ALL_BETS = [];   // [{ userId, bet, money }]

/* ===== WEBHOOK ===== */
app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.sendStatus(200))
    .catch(err => {
      console.error(err);
      res.sendStatus(500);
    });
});

/* ===== MAIN HANDLER ===== */
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const text = event.message.text.trim();
  const userId = event.source.userId;
  const token = event.replyToken;

  /* ===== ADMIN ===== */
  if (text === "O") {
    SYSTEM.OPEN = true;
    return reply(token, "🟢 เปิดรับแทงแล้ว");
  }

  if (text === "CLOSE") {
    SYSTEM.OPEN = false;
    return reply(token, "🔴 ปิดรับแทงแล้ว");
  }

  if (text === "RESET") {
    USERS = {};
    ALL_BETS = [];
    SYSTEM.OPEN = false;
    return reply(token, "♻️ รีเซ็ตรอบเรียบร้อย");
  }

  /* ===== SUMMARY (รวมยอด) ===== */
  if (text === "SUMMARY") {
    const total = ALL_BETS.reduce((sum, b) => sum + b.money, 0);
    return reply(
      token,
      `📊 สรุปรอบ\nจำนวนโพย: ${ALL_BETS.length}\nยอดรวม: ${total}`
    );
  }

  /* ===== RESULT ===== */
  if (!SYSTEM.OPEN && ALL_BETS.length === 0 && text.startsWith("RESULT")) {
    return reply(token, "⚠️ รอบนี้สรุปไปแล้ว");
  }

  if (text.startsWith("RESULT")) {
    const result = text.split(" ")[1];
    if (!result) return reply(token, "❌ ใช้คำสั่ง: RESULT 1");

    const summary = calcSummaryByUser(result);

    let msg = `🎲 ผลออก: ${result}\n\n📊 สรุปเดิมพนัน`;

    Object.keys(summary).forEach(uid => {
      const shortId = uid.slice(-5);
      const amount = summary[uid];
      const sign = amount >= 0 ? "+" : "";
      msg += `\n• ${shortId} : ${sign}${amount}`;
    });

    USERS = {};
    ALL_BETS = [];
    SYSTEM.OPEN = false;

    return reply(token, msg);
  }

  /* ===== CANCEL ===== */
  if (text === "DL") {
    if (!USERS[userId]) return reply(token, "❌ ไม่มีโพย");
    USERS[userId].bets.forEach(b => {
      ALL_BETS = ALL_BETS.filter(x => x !== b);
    });
    USERS[userId].bets = [];
    return reply(token, "♻️ ยกเลิกโพยแล้ว");
  }

  /* ===== BETTING ===== */
  if (text.includes("/")) {
    if (!SYSTEM.OPEN) return reply(token, "❌ ปิดรับแทง");

    const [bet, amt] = text.split("/");
    const money = parseInt(amt);

    if (isNaN(money) || money <= 0) {
      return reply(token, "❌ รูปแบบแทงไม่ถูกต้อง");
    }

    if (!USERS[userId]) USERS[userId] = { bets: [] };

    const betData = { userId, bet, money };
    USERS[userId].bets.push(betData);
    ALL_BETS.push(betData);

    return reply(token, `🎯 รับโพยแล้ว\n${bet}/${money}`);
  }

  return reply(token, "❓ คำสั่งไม่ถูกต้อง");
}

/* ===== CALC SUMMARY BY USER ===== */
function calcSummaryByUser(result) {
  const summary = {};

  ALL_BETS.forEach(b => {
    if (!summary[b.userId]) summary[b.userId] = 0;

    if (b.bet === result) {
      summary[b.userId] += b.money;
    } else {
      summary[b.userId] -= b.money;
    }
  });

  return summary;
}

/* ===== REPLY ===== */
function reply(token, text) {
  return client.replyMessage(token, {
    type: "text",
    text,
  });
}

/* ===== SERVER ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("RUNNING ON PORT", PORT);
});
  Object.keys(summary).forEach(uid => {
    const shortId = uid.slice(-5);
    const amount = summary[uid];
    const sign = amount >= 0 ? "+" : "";
    msg += `\n• ${shortId} : ${sign}${amount}`;
  });

  USERS = {};
  ALL_BETS = [];
  SYSTEM.OPEN = false;

  return reply(token, msg);
96 }
95
96    // ===== CANCEL =====
97    if (text === "DL") {
98      if (!USERS[userId]) return reply(token, "❌ ไม่มีโพย");
99
100     USERS[userId].bets.forEach(b => {
101       ALL_BETS = ALL_BETS.filter(x => x !== b);
102     });
103     USERS[userId].bets = [];
104     return reply(token, "♻ ยกเลิกโพยแล้ว");
105   }
106
107   // ===== BETTING =====
108   if (text.includes("/")) {
109     if (!SYSTEM.OPEN) return reply(token, "❌ ปิดรับแทง");
110
111     const [bet, amt] = text.split("/");
112     const money = parseInt(amt);
113     if (isNaN(money) || money <= 0) {
114       return reply(token, "❌ รูปแบบแทงไม่ถูกต้อง");
115     }
116
117     if (!USERS[userId]) USERS[userId] = { bets: [] };
118
119     const betData = { userId, bet, money };
120     USERS[userId].bets.push(betData);
121     ALL_BETS.push(betData);
122
123     return reply(token, `🎯 รับโพยแล้ว\n${bet}/${money}`);
124   }
125
126   return reply(token, "❓ คำสั่งไม่ถูกต้อง");
127 }
128
129 // ===== CALC RESULT =====
130 function calcResult(result) {
 function calcSummaryByUser(result) {
  const summary = {};

  ALL_BETS.forEach(b => {
    if (!summary[b.userId]) summary[b.userId] = 0;

    if (b.bet === result) {
      summary[b.userId] += b.money * SYSTEM.RATE;
    } else {
      summary[b.userId] -= b.money;
    }
  });

  return summary;
 }
131   let summary = {};
132
133   ALL_BETS.forEach(b => {
134     if (!summary[b.userId]) summary[b.userId] = 0;
135
136     if (b.bet === result) {
137       summary[b.userId] += b.money * SYSTEM.RATE;
138     } else {
139       summary[b.userId] -= b.money;
140     }
141   });
142
143   return summary;
144 }
145 // ===== REPLY =====
146 function reply(token, text) {
147   return client.replyMessage(token, {
148     type: "text",
149     text
150   });
151 }
152
153 // ===== START SERVER =====
154 const PORT = process.env.PORT || 3000;
155 app.listen(PORT, () => {
156   console.log("RUNNING ON PORT", PORT);
157 });    if (!SYSTEM.OPEN) return reply(token, "❌ ปิดรับแทง");

    const [bet, amt] = text.split("/");
    const money = parseInt(amt);
    if (isNaN(money) || money <= 0) {
      return reply(token, "❌ รูปแบบแทงไม่ถูกต้อง");
    }

    if (!USERS[userId]) USERS[userId] = { bets: [] };

    const betData = { userId, bet, money };
    USERS[userId].bets.push(betData);
    ALL_BETS.push(betData);

    return reply(token, `🎯 รับโพยแล้ว\n${bet}/${money}`);
  }
return reply(token, "❓ คำสั่งไม่ถูกต้อง");
}
function calcResult(result) {
  let win = 0;
  let lose = 0;

  ALL_BETS.forEach(b => {
    if (b.bet === result) {
      win += b.money * SYSTEM.RATE;
    } else {
      lose += b.money;
    }
  });

  return { win, lose };
}
function reply(token, text) {
  return client.replyMessage(token, {
    type: "text",
    text
  });
}
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("RUNNING ON PORT", PORT);
});
