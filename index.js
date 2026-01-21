1  require("dotenv").config();
 2  const express = require("express");
 3  const line = require("@line/bot-sdk");
 4
 5  const app = express();
 6
 7  const config = {
 8    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
 9    channelSecret: process.env.LINE_CHANNEL_SECRET
10  };
11
12  // ❗ ห้ามลบ
13  const client = new line.Client(config);
14
15  // ===== SYSTEM DATA =====
16  let SYSTEM = {
17    OPEN: false,
18    RATE: 1
19  };
20
21  let USERS = {};
22  let ALL_BETS = [];
23
24  // ===== WEBHOOK =====
25  app.post("/webhook", line.middleware(config), (req, res) => {
26    Promise.all(req.body.events.map(handleEvent))
27      .then(() => res.status(200).end())
28      .catch(err => {
29        console.error(err);
30        res.status(500).end();
31      });
32  });
33
34  // ===== MAIN HANDLER =====
35  function handleEvent(event) {
36    if (event.type !== "message") return Promise.resolve(null);
37    if (event.message.type !== "text") return Promise.resolve(null);
38
39    const text = event.message.text.trim();
40    const userId = event.source.userId;
41    const token = event.replyToken;
42
43    // ===== ADMIN =====
44    if (text === "O") {
45      SYSTEM.OPEN = true;
46      return reply(token, "🟢 เปิดรับแทงแล้ว");
47    }
48
49    if (text === "CLOSE") {
50      SYSTEM.OPEN = false;
51      return reply(token, "🔴 ปิดรับแทงแล้ว");
52    }
53
54    if (text.startsWith("RATE")) {
55      SYSTEM.RATE = parseFloat(text.split(" ")[1]);
56      return reply(token, `⚙ ตั้งค่าน้ำ ${SYSTEM.RATE}`);
57    }
58
59    if (text === "RESET") {
60      USERS = {};
61      ALL_BETS = [];
62      return reply(token, "♻ รีเซ็ตรอบเรียบร้อย");
63    }
64
65    // ===== SUMMARY =====
66    if (text === "SUMMARY") {
67      const total = ALL_BETS.reduce((sum, b) => sum + b.money, 0);
68      return reply(
69        token,
70        `📊 สรุปรอบ
71 จำนวนโพย: ${ALL_BETS.length}
72 ยอดรวม: ${total}`
73      );
74    }
75
76    // ===== RESULT =====
77    if (text.startsWith("RESULT")) {
78      const result = text.split(" ")[1];
79      if (!result) return reply(token, "❌ ใช้คำสั่ง: RESULT 1");
80
81      const { win, lose } = calcResult(result);
82
83      USERS = {};
84      ALL_BETS = [];
85      SYSTEM.OPEN = false;
86
87      return reply(
88        token,
89        `🎲 ผลออก: ${result}
90 💰 ชนะ: ${win}
91 💸 แพ้: ${lose}
92 🔒 ปิดรอบแล้ว`
93      );
94    }
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
131   let win = 0;
132   let lose = 0;
133
134   ALL_BETS.forEach(b => {
135     if (b.bet === result) {
136       win += b.money * SYSTEM.RATE;
137     } else {
138       lose += b.money;
139     }
140   });
141
142   return { win, lose };
143 }
144
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
