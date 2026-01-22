/**************************************
 * LINE BOT – HILO / OPEN THUA (#U CORE)
 * Single file, Anti-502
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

/* ===== MIDDLEWARE (keep rawBody for signature) ===== */
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

/* ===== UTIL ===== */
const isAdmin = uid => ADMIN_IDS.includes(uid);
const rand = () => Math.floor(Math.random()*6)+1;
const isTriple = d => d[0]===d[1] && d[1]===d[2];

/* ===== STATE ===== */
let PLAY_ROOM_ID = null;
let DEPOSIT_ROOM_ID = null;

let CONFIG = {
  OPEN: false,
  waterLose: 0,     // N/1 = หักฝั่งเสีย %
  waterWin: 0,      // NC/1 = หักฝั่งได้ %
  MIN: 1,
  MAX: 999999,
  FULL: 999999,
  withdrawOpen: true
};

let USERS = {}; 
// USERS[uid] = { credit, name, blocked, playCount, history:[] }

let BETS = [];      // current round bets
let LAST = null;    // last round snapshot for BACK

/* ===== VERIFY SIGNATURE ===== */
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

/* ===== ROOT ===== */
app.get("/", (_,res)=>res.status(200).send("BOT OK"));

/* ===== WEBHOOK (ANTI 502) ===== */
app.post("/webhook", (req,res)=>{
  res.sendStatus(200); // ตอบก่อนเสมอ
  if(!verifySignature(req)) return;
  (req.body.events||[]).forEach(handleEvent);
});

/* ===== HELPERS ===== */
function getUser(uid){
  if(!USERS[uid]){
    USERS[uid] = { credit:0, name:"", blocked:false, playCount:0, history:[] };
  }
  return USERS[uid];
}

function sumDice(d){ return d[0]+d[1]+d[2]; }
function beanFromSum(sum){ return sum % 4 === 0 ? 4 : sum % 4; }
// SCORE ตามรูป : มีแดง(1)=4 , ไม่มีแดง=3
function calcScore(dice){
  return dice.includes(1) ? 4 : 3;
}
/* ===== PAY LOGIC =====
 * รองรับ:
 * - เต็ง (1 ตัว): ออก 1/2/3 ลูก → x1/x2/x3 (รวมทุน)
 * - โต๊ด (2 ตัว): x5 (รวมทุน)
 * - ตองระบุ (เช่น 111): x100 (รวมทุน)
 * - สูง/ต่ำ (H/L): x1 (รวมทุน) | ตองกิน
 */
function calcWin(bet, amt, dice){
  const [a,b,c] = dice;
  const sum = sumDice(dice);
  const counts = {};
  dice.forEach(x=>counts[x]=(counts[x]||0)+1);

  // สูง/ต่ำ
  if(bet === "H"){
    if(!isTriple(dice) && sum>=11 && sum<=17) return amt*2;
  }
  if(bet === "L"){
    if(!isTriple(dice) && sum>=4 && sum<=10) return amt*2;
  }

  // ตองระบุ (111)
  if(/^\d{3}$/.test(bet)){
    const n = Number(bet[0]);
    if(dice.every(d=>d===n)) return amt*101;
  }

  // โต๊ด (12)
  if(/^\d{2}$/.test(bet)){
    const x = Number(bet[0]), y = Number(bet[1]);
    if(counts[x]>=1 && counts[y]>=1) return amt*6;
  }

  // เต็ง (1)
  if(/^\d$/.test(bet)){
    const n = Number(bet);
    const hit = counts[n]||0;
    if(hit===1) return amt*2;
    if(hit===2) return amt*3;
    if(hit===3) return amt*4;
  }

  return 0;
}

/* ===== EVENT HANDLER ===== */
async function handleEvent(event){
  if(event.type!=="message" || event.message.type!=="text") return;

  const text = event.message.text.trim();
  const uid  = event.source.userId;
  const token = event.replyToken;
  const roomId = event.source.groupId || event.source.roomId || null;

  const user = getUser(uid);
// ===== SHOW MY ID =====
  if (text === "MYID") {
    return reply(
      token,
`🆔 MY LINE USER ID
━━━━━━━━━━━━━━
${uid}
━━━━━━━━━━━━━━
📋 แตะค้างเพื่อคัดลอก`
    );
  }
  /* ===== AUTO SAVE ROOMS ===== */
  if(isAdmin(uid)){
    if(!PLAY_ROOM_ID && (text==="O" || text==="X")) PLAY_ROOM_ID = roomId;
    if(!DEPOSIT_ROOM_ID && (text.startsWith("N/") || text.startsWith("NC/"))) DEPOSIT_ROOM_ID = roomId;
  }

  /* ===== ADMIN – PLAY ROOM ===== */
  if(isAdmin(uid) && roomId === PLAY_ROOM_ID){

    if(text==="O"){
      CONFIG.OPEN = true;
      BETS = [];
      return reply(token,"🟢 เปิดรับเดิมพัน");
    }
    if(text==="X"){
      CONFIG.OPEN = false;
      return reply(token,"🔴 ปิดรับเดิมพัน");
    }
    if(text==="RESET"){
      BETS = [];
      return reply(token,"♻️ รีรอบ (ล้างโพย)");
    }
    if(text==="REFUND"){
      BETS.forEach(b=> getUser(b.uid).credit += b.amount);
      BETS = [];
      return reply(token,"💸 คืนยอดเรียบร้อย");
    }
    if(text==="BACK"){
      if(!LAST) return reply(token,"❌ ไม่มีผลให้ย้อน");
      LAST.payouts.forEach(p=>{
        const u = getUser(p.uid);
        u.credit -= p.win;
        u.credit += p.amount;
      });
      LAST = null;
      return reply(token,"⏪ ย้อนผลเรียบร้อย");
    }
    if(/^S\d{3}$/.test(text)){
      // บังคับผล เช่น S123
      const d = text.slice(1).split("").map(Number);
      return settleRound(token, d);
    }
  }

  /* ===== ADMIN – DEPOSIT ROOM ===== */
  if(isAdmin(uid) && roomId === DEPOSIT_ROOM_ID){

    if(/^N\/\d+(\.\d+)?$/.test(text)){
      CONFIG.waterLose = Number(text.split("/")[1]);
      return reply(token,`⚙️ ตั้งน้ำฝั่งเสีย ${CONFIG.waterLose}%`);
    }
    if(/^NC\/\d+(\.\d+)?$/.test(text)){
      CONFIG.waterWin = Number(text.split("/")[1]);
      return reply(token,`⚙️ ตั้งน้ำฝั่งได้ ${CONFIG.waterWin}%`);
    }
    if(/^MIN\/\d+$/.test(text)){
      CONFIG.MIN = Number(text.split("/")[1]);
      return reply(token,`⚙️ MIN ${CONFIG.MIN}`);
    }
    if(/^MAX\/\d+$/.test(text)){
      CONFIG.MAX = Number(text.split("/")[1]);
      return reply(token,`⚙️ MAX ${CONFIG.MAX}`);
    }
    if(/^FULL\/\d+$/.test(text)){
      CONFIG.FULL = Number(text.split("/")[1]);
      return reply(token,`⚙️ FULL ${CONFIG.FULL}`);
    }
    if(/^BLOCK\/\w+/.test(text)){
      const id = text.split("/")[1];
      const u = getUser(id);
      u.blocked = !u.blocked;
      return reply(token, u.blocked ? `⛔ บล็อก ${id}` : `✅ ปลดบล็อก ${id}`);
    }
    if(/^NM\/[^/]+\/.+$/.test(text)){
      const [,id,name] = text.split("/");
      getUser(id).name = name;
      return reply(token,`🏷️ บันทึกชื่อ ${id}`);
    }
    if(/^\w+\+\d+$/.test(text)){
      const [id,amt] = text.split("+");
      getUser(id).credit += Number(amt);
      return reply(token,`➕ เติม ${amt}`);
    }
    if(/^\w+-\d+$/.test(text)){
      const [id,amt] = text.split("-");
      getUser(id).credit -= Number(amt);
      return reply(token,`➖ ถอน ${amt}`);
    }
    if(/\sCR$/.test(text)){
      const id = text.split(" ")[0];
      return reply(token,`💰 เครดิต ${id}: ${getUser(id).credit}`);
    }
    if(/\sLL$/.test(text)){
      const id = text.split(" ")[0];
      return reply(token,`📊 ${id} เล่น ${getUser(id).playCount} เปิด`);
    }
    if(/\sCX$/.test(text)){
      const id = text.split(" ")[0];
      const u = getUser(id);
      let m = `📈 ${u.name||id}`;
      u.history.slice(-10).forEach(h=> m+=`\n• ${h}`);
      return reply(token,m);
    }
  }

  /* ===== PLAYER – PLAY ROOM ===== */
  if(roomId === PLAY_ROOM_ID){
    if(user.blocked) return reply(token,"⛔ ไอดีถูกบล็อก");

    if(text==="C"){
      return reply(token,`💰 เครดิต ${user.credit}`);
    }
    if(text==="DL" || text==="X"){
      const mine = BETS.filter(b=>b.uid===uid);
      mine.forEach(b=> user.credit += b.amount);
      BETS = BETS.filter(b=>b.uid!==uid);
      return reply(token,"♻️ ยกเลิกโพยแล้ว");
    }

    // รับโพย
    if(/^([HL]|\d{1,3})\/\d+$/.test(text)){
      if(!CONFIG.OPEN) return reply(token,"❌ ปิดรับแทง");
      const [bet,amtS] = text.split("/");
      const amt = Number(amtS);

      if(amt<CONFIG.MIN || amt>CONFIG.MAX) return reply(token,"❌ จำนวนเงินไม่ถูกต้อง");
      const sumMine = BETS.filter(b=>b.uid===uid).reduce((s,x)=>s+x.amount,0);
      if(sumMine+amt>CONFIG.FULL) return reply(token,"❌ เกินอั้นต่อคน");
      if(user.credit<amt) return reply(token,"❌ เครดิตไม่พอ");

      user.credit -= amt;
      BETS.push({ uid, bet, amount:amt });
      return reply(token,`✅ รับ ${bet}/${amt}\nคงเหลือ ${user.credit}`);
    }
  }
}

/* ===== SETTLE ROUND ===== */
function settleRound(token, dice){
  CONFIG.OPEN = false;

  const sum = sumDice(dice);
  const bean = beanFromSum(sum);
  const score = calcScore(dice);   // ← ใส่บรรทัดนี้
  let msg = `🎲 ปิดรอบ\nผลเต๋า ${dice.join(" + ")} = ${sum}\nผลถั่ว : ${bean}\n\n`;
  msg += score === 4 ? "🟥 สกอร์ 4\n" : "🟨 สกอร์ 3\n";
  const payouts = [];

  BETS.forEach(b=>{
    let win = calcWin(b.bet, b.amount, dice);

    if(win>0){
      // water
      if(CONFIG.waterWin>0){
        win = Math.floor(win*(100-CONFIG.waterWin)/100);
      }
      const u = getUser(b.uid);
      u.credit += win;
      u.playCount++;
      u.history.push(`${b.bet}/${b.amount} +${win}`);
      payouts.push({ uid:b.uid, amount:b.amount, win });
      msg += `✔ ${b.bet}/${b.amount} +${win}\n`;
    }else{
      if(CONFIG.waterLose>0){
        const fee = Math.floor(b.amount*CONFIG.waterLose/100);
        // ฝั่งเสีย หักต๋ง (ไม่คืน)
        msg += `✖ ${b.bet}/${b.amount} เสีย\n`;
      }else{
        msg += `✖ ${b.bet}/${b.amount}\n`;
      }
    }
  });

  LAST = { dice, payouts, score };
  BETS = [];
  reply(token, msg || "ไม่มีผู้ชนะ");
}

/* ===== START ===== */
app.listen(PORT, ()=>console.log("BOT READY"));
