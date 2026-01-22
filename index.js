require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

/* ===== ENV ===== */
const LINE_TOKEN  = process.env.LINE_TOKEN;
const LINE_SECRET = process.env.LINE_SECRET;
const ADMIN_IDS   = (process.env.ADMIN_IDS || "").split(",");
const PORT        = process.env.PORT || 3000;

/* ===== STATE ===== */
let BET_OPEN = false;
let ROUND = 1;
let BETS = [];
let LAST_ROUND = null;

let USERS = {}; 
// USERS[uid] = { credit }

/* ===== UTIL ===== */
const isAdmin = uid => ADMIN_IDS.includes(uid);

function getUser(uid){
  if(!USERS[uid]) USERS[uid] = { credit: 0 };
  return USERS[uid];
}

/* ===== LINE VERIFY ===== */
function verify(req){
  const sig = req.headers["x-line-signature"];
  const body = JSON.stringify(req.body);
  const hash = crypto.createHmac("sha256", LINE_SECRET).update(body).digest("base64");
  return sig === hash;
}

/* ===== REPLY ===== */
async function reply(token, text){
  return axios.post(
    "https://api.line.me/v2/bot/message/reply",
    { replyToken: token, messages:[{ type:"text", text }] },
    { headers:{ Authorization:`Bearer ${LINE_TOKEN}` } }
  );
}

/* ===== GAME LOGIC ===== */
const rollDice = () => [
  Math.ceil(Math.random()*6),
  Math.ceil(Math.random()*6),
  Math.ceil(Math.random()*6)
];

const calcBean = sum => sum % 4 === 0 ? 4 : sum % 4;

/* ===== PAYOUT ===== */
function calcWin(bet, dice){
  const [a,b,c] = dice;
  const sum = a+b+c;
  const bean = calcBean(sum);
  const triple = a===b && b===c;

  if(bet.type==="BEAN" && bet.value===bean) return bet.amount * 3;
  if(bet.type==="SPRAY" && [1,2,3].includes(bean)) return bet.amount * 25;
  if(bet.type==="BLOW" && triple && a===5) return bet.amount * 100;

  return 0;
}

/* ===== PARSE BET ===== */
function parseBet(text, uid){
  if(/^[1-4]\/\d+$/.test(text)){
    const [n,amt] = text.split("/").map(Number);
    return { uid, type:"BEAN", value:n, amount:amt };
  }
  if(/^123\/\d+$/.test(text)){
    return { uid, type:"SPRAY", amount:Number(text.split("/")[1]) };
  }
  if(/^555\/\d+$/.test(text)){
    return { uid, type:"BLOW", amount:Number(text.split("/")[1]) };
  }
  return null;
}

/* ===== WEBHOOK ===== */
app.post("/webhook", async (req,res)=>{
  if(!verify(req)) return res.sendStatus(403);
  res.sendStatus(200);

  const ev = req.body.events[0];
  if(!ev || ev.type!=="message" || ev.message.type!=="text") return;

  const text = ev.message.text.trim();
  const uid  = ev.source.userId;
  const token = ev.replyToken;
  const user = getUser(uid);

  /* ===== ADMIN ===== */
  if(isAdmin(uid)){
    if(text==="OPEN"){
      BET_OPEN = true;
      BETS = [];
      return reply(token, `🟢 เปิดรับเดิมพัน รอบที่ ${ROUND}`);
    }

    if(text==="CLOSE"){
      BET_OPEN = false;
      return reply(token, "🔴 ปิดรับเดิมพัน");
    }

    if(text==="ROLL"){
      const dice = rollDice();
      const sum = dice.reduce((a,b)=>a+b,0);
      const bean = calcBean(sum);

      let msg = `🎲 ปิดรอบ #${ROUND}\n`;
      msg += `ผลเต๋า ${dice.join(" + ")} = ${sum}\n`;
      msg += `ผลถั่ว : ${bean}\n\n`;

      BETS.forEach(b=>{
        const win = calcWin(b,dice);
        if(win>0){
          getUser(b.uid).credit += win;
          msg += `✔ ${b.uid.slice(-4)} ได้ +${win}\n`;
        }
      });

      LAST_ROUND = [...BETS];
      BETS = [];
      BET_OPEN = false;
      ROUND++;

      return reply(token, msg || "ไม่มีผู้ชนะ");
    }

    if(text==="BACK" && LAST_ROUND){
      LAST_ROUND.forEach(b=>{
        getUser(b.uid).credit += b.amount;
      });
      BETS = LAST_ROUND;
      LAST_ROUND = null;
      ROUND--;
      return reply(token, "⏪ ย้อนผล คืนเครดิตเรียบร้อย");
    }

    if(text.startsWith("ADD")){
      const [,id,amt] = text.split(" ");
      getUser(id).credit += Number(amt);
      return reply(token, `➕ เติมเครดิต ${amt}`);
    }

    if(text.startsWith("SUB")){
      const [,id,amt] = text.split(" ");
      getUser(id).credit -= Number(amt);
      return reply(token, `➖ ถอนเครดิต ${amt}`);
    }
  }

  /* ===== PLAYER ===== */
  if(text==="C"){
    return reply(token, `💰 เครดิตคงเหลือ ${user.credit}`);
  }

  if(!BET_OPEN) return;

  const bet = parseBet(text, uid);
  if(!bet) return;

  if(user.credit < bet.amount){
    return reply(token, "❌ เครดิตไม่พอ");
  }

  user.credit -= bet.amount;
  BETS.push(bet);

  return reply(token, `✅ รับโพย ${text}\nคงเหลือ ${user.credit}`);
});

/* ===== HEALTH ===== */
app.get("/",(_,res)=>res.send("CREDIT BOT RUNNING"));
app.listen(PORT, ()=>console.log("RUNNING",PORT));
