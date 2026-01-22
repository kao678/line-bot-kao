/**************************************
 * LINE BOT – HILO / OPEN THUA (#U CORE)
 * Single file, Anti-502 (FIXED)
 **************************************/
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();

/* ===== ENV ===== */
const PORT = process.env.PORT || 3000;
const LINE_TOKEN  = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET;
const ADMIN_IDS   = (process.env.ADMIN_IDS || "").split(",").filter(Boolean);

/* ===== MIDDLEWARE ===== */
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

/* ===== UTIL ===== */
const isAdmin = uid => ADMIN_IDS.includes(uid);
const isTriple = d => d[0]===d[1] && d[1]===d[2];

/* ===== STATE ===== */
let PLAY_ROOM_ID = null;
let DEPOSIT_ROOM_ID = null;

let CONFIG = {
  OPEN: false,
  waterLose: 0,
  waterWin: 0,
  MIN: 1,
  MAX: 999999,
  FULL: 999999,
  PAY_WIN: 1,
  PAY_LOSE: 3
};

let USERS = {};
let BETS = [];
let LAST = null;

/* ===== VERIFY ===== */
function verifySignature(req){
  const sig = req.headers["x-line-signature"];
  if(!sig) return false;
  const hash = crypto.createHmac("sha256", LINE_SECRET)
    .update(req.rawBody)
    .digest("base64");
  return sig === hash;
}

/* ===== REPLY ===== */
function reply(token, text){
  return axios.post(
    "https://api.line.me/v2/bot/message/reply",
    { replyToken: token, messages:[{ type:"text", text }] },
    { headers:{ Authorization:`Bearer ${LINE_TOKEN}` } }
  ).catch(()=>{});
}

/* ===== WEBHOOK ===== */
app.post("/webhook",(req,res)=>{
  res.sendStatus(200);
  if(!verifySignature(req)) return;
  (req.body.events||[]).forEach(handleEvent);
});

/* ===== HELPERS ===== */
function getUser(uid){
  if(!USERS[uid]){
    USERS[uid]={ credit:0, blocked:false, playCount:0, history:[] };
  }
  return USERS[uid];
}
const sumDice = d => d[0]+d[1]+d[2];

/* ===== PAY LOGIC ===== */
function calcWin(bet, amt, dice){
  const sum = sumDice(dice);
  const counts = {};
  dice.forEach(x=>counts[x]=(counts[x]||0)+1);

  if(bet==="456" && dice.includes(4)&&dice.includes(5)&&dice.includes(6)){
    return amt*26;
  }

  if(/^\d{3}$/.test(bet)){
    const n = Number(bet[0]);
    if(dice.every(d=>d===n)) return amt*101;
  }

  if(bet==="H" && !isTriple(dice) && sum>=11 && sum<=17) return amt*2;
  if(bet==="L" && !isTriple(dice) && sum>=4  && sum<=10) return amt*2;

  if(/^\d{2}$/.test(bet)){
    const x=Number(bet[0]),y=Number(bet[1]);
    if(counts[x]&&counts[y]) return amt*6;
  }

  if(/^\d$/.test(bet)){
    const n=Number(bet),hit=counts[n]||0;
    if(hit===1) return amt*2;
    if(hit===2) return amt*3;
    if(hit===3) return amt*4;
  }
  return 0;
}

/* ===== EVENT ===== */
async function handleEvent(event){
  if(event.type!=="message"||event.message.type!=="text") return;

  const text=event.message.text.trim();
  const uid=event.source.userId;
  const token=event.replyToken;
  const roomId=event.source.groupId||event.source.roomId||null;
  const user=getUser(uid);

  /* auto save rooms */
  if(isAdmin(uid)){
    if(!PLAY_ROOM_ID && (text==="O"||text==="X")) PLAY_ROOM_ID=roomId;
    if(!DEPOSIT_ROOM_ID && (text.startsWith("N/")||text.startsWith("NC/"))) DEPOSIT_ROOM_ID=roomId;
  }

  /* ===== ADMIN – PLAY ROOM ===== */
  if(isAdmin(uid) && roomId===PLAY_ROOM_ID){

    if(/^PAY\/\d+\/\d+$/.test(text)){
      const [,w,l]=text.split("/");
      CONFIG.PAY_WIN=Number(w);
      CONFIG.PAY_LOSE=Number(l);
      return reply(token,`⚙️ ตั้ง PAY จ่าย ${w} ต่อ / เสีย ${l} ต่อ`);
    }

    if(text==="O"){ CONFIG.OPEN=true; BETS=[]; return reply(token,"🟢 เปิดรับเดิมพัน"); }
    if(text==="X"){ CONFIG.OPEN=false; return reply(token,"🔴 ปิดรับเดิมพัน"); }
    if(text==="RESET"){ BETS=[]; return reply(token,"♻️ รีรอบ"); }

    if(text==="BACK"){
      if(!LAST) return reply(token,"❌ ไม่มีผลให้ย้อน");
      LAST.payouts.forEach(p=>{
        const u=getUser(p.uid);
        u.credit-=p.win;
        u.credit+=p.amount;
      });
      LAST=null;
      return reply(token,"⏪ ย้อนผลเรียบร้อย");
    }

    if(/^S\d{3}$/.test(text)){
      const d=text.slice(1).split("").map(Number);
      return settleRound(token,d);
    }
  }

  /* ===== PLAYER ===== */
  if(roomId===PLAY_ROOM_ID){
    if(text==="C") return reply(token,`💰 เครดิต ${user.credit}`);

    if(/^([HL]|\d{1,3})\/\d+$/.test(text)){
      if(!CONFIG.OPEN) return reply(token,"❌ ปิดรับแทง");
      const[bet,a]=text.split("/");
      const amt=Number(a);
      if(user.credit<amt) return reply(token,"❌ เครดิตไม่พอ");

      user.credit-=amt;
      BETS.push({uid,bet,amount:amt});
      return reply(token,`✅ รับ ${bet}/${amt}`);
    }
  }
}

/* ===== SETTLE ===== */
function settleRound(token,dice){
  CONFIG.OPEN=false;
  let msg=`🎲 ผล ${dice.join("+")}\n`;
  const payouts=[];

  BETS.forEach(b=>{
    const u=getUser(b.uid);
    const win=calcWin(b.bet,b.amount,dice);

    if(win>0){
      u.credit+=win;
      payouts.push({uid:b.uid,amount:b.amount,win});
      msg+=`✔ ${b.bet} +${win}\n`;
    }else{
      const lose=b.amount*CONFIG.PAY_LOSE;
      u.credit-=(lose-b.amount);
      msg+=`✖ ${b.bet} -${lose}\n`;
    }
  });

  LAST={dice,payouts};
  BETS=[];
  reply(token,msg||"ไม่มีผู้ชนะ");
}

/* ===== START ===== */
app.listen(PORT,()=>console.log("BOT READY"));
