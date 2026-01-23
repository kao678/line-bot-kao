const fs = require("fs");

const DB_FILE = "./data.json";

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

module.exports = { loadDB, saveDB };
