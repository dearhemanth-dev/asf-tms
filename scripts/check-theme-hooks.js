const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = path.join(process.cwd(), "src", "app");
const PAGE_FILE = "page.tsx";
const REQUIRED_THEME_HOOK_PATTERN = /theme-page-shell|theme-light-flip|theme-page-|fault-theme-scope/;

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name === PAGE_FILE) {
      out.push(fullPath);
    }
  }
}

function toRelative(filePath) {
  return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}

const pageFiles = [];
walk(APP_DIR, pageFiles);

const missing = [];
for (const filePath of pageFiles) {
  const content = fs.readFileSync(filePath, "utf8");
  if (!content.includes("<main")) {
    continue;
  }
  if (!REQUIRED_THEME_HOOK_PATTERN.test(content)) {
    missing.push(toRelative(filePath));
  }
}

if (missing.length > 0) {
  console.error("Theme hook check failed. Add a page-level theme hook class to each file:");
  for (const file of missing) {
    console.error(` - ${file}`);
  }
  process.exit(1);
}

console.log(`Theme hook check passed for ${pageFiles.length} page files.`);
