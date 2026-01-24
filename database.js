const fs = require("fs");
const FILE = "./data.json";

function load() {
  if (!fs.existsSync(FILE)) {
    return {
      users: {},
      bets: {},
      admins: [],
      adminRoom: null,
      playRoom: null,
      depositRoom: null,
      slips: {},
      round: 1,
      config: {
        open: false,
        min: 50,
        max: 2000,
        waterLose: 1,
        waterWin: 0,
        freeWaterRounds: []
      },
      lastResult: null
    };
  }

  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));

  // 🔐 กันพัง กรณีข้อมูลเก่า
  data.users ??= {};
  data.bets ??= {};
  data.admins ??= [];
  data.slips ??= {};
  data.round ??= 1;
  data.adminRoom ??= null;
  data.playRoom ??= null;
  data.depositRoom ??= null;
  data.config ??= {
    open: false,
    min: 50,
    max: 2000,
    waterLose: 1,
    waterWin: 0,
    freeWaterRounds: []
  };

  return data;
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

module.exports = { load, save };
