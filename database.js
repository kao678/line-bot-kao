const fs = require("fs");
const FILE = "./data.json";

function load() {
  if (!fs.existsSync(FILE)) {
    return {
      users: {},
      bets: {},
      admins: [],
      config: {
        open: false,
        min: 50,
        max: 2000
      },
      lastResult: null
    };
  }
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

module.exports = { load, save };
