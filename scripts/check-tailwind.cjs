const fs = require("fs");
const path = require("path");

const cssDir = path.join(process.cwd(), ".next", "static", "css");

if (!fs.existsSync(cssDir)) {
  throw new Error("Tailwind check failed: .next/static/css does not exist");
}

const css = fs.readdirSync(cssDir)
  .filter(file => file.endsWith(".css"))
  .map(file => fs.readFileSync(path.join(cssDir, file), "utf8"))
  .join("\n");

const requiredUtilities = [
  ".flex{display:flex}",
  ".grid{display:grid}",
  ".max-w-7xl{max-width:80rem}"
];

const missing = requiredUtilities.filter(utility => !css.includes(utility));
if (missing.length > 0) {
  throw new Error(`Tailwind check failed: missing generated utilities ${missing.join(", ")}`);
}

console.log("Tailwind CSS utilities verified.");
