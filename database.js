const fs = require("fs");
const DB_FILE = "./data.json";

exports.load = () => JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
exports.save = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
