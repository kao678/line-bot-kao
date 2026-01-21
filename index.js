require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);

app.post("/webhook", line.middleware(config), (req, res) => {
  console.log("EVENT:", JSON.stringify(req.body));
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => {
      console.error("ERROR:", err);
      res.status(500).end();
    });
});

function handleEvent(event) {
  if (event.type !== "message") return Promise.resolve(null);
  if (event.message.type !== "text") return Promise.resolve(null);

  const text = event.message.text;
  console.log("MSG:", text);

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: `รับแล้ว: ${text}`
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("RUNNING ON PORT", PORT);
});
