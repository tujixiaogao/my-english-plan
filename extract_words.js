const fs = require("fs");
const path = "C:/Users/admin/WorkBuddy/2026-07-21-22-30-52/words.js";
const code = fs.readFileSync(path, "utf8");
const WORDS = new Function(code + "\nreturn WORDS;")();
const meta = WORDS.map((w, i) => ({ i, w: w.w, ex: w.ex || "", zh: w.zh || "" }));
fs.writeFileSync("C:/Users/admin/WorkBuddy/2026-07-21-22-30-52/audio_meta.json", JSON.stringify(meta));
console.log("extracted", meta.length, "words");
