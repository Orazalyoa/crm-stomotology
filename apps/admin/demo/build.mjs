import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const output = resolve(process.env.PAGES_OUTPUT_DIR ?? resolve(repoRoot, "_site"));
const adminOutput = resolve(output, "admin");
const assetsOutput = resolve(adminOutput, "assets");

await mkdir(assetsOutput, { recursive: true });

const files = [
  ["apps/admin/demo/index.html", "index.html"],
  ["apps/admin/mobile.html", "admin/mobile.html"],
  ["apps/admin/pages.js", "admin/pages.js"],
  ["apps/admin/demo/api.js", "admin/demo-api.js"],
  ["apps/auth/login.html", "admin/login.html"],
  ["apps/shared/booking-dialog.js", "admin/assets/booking-dialog.js"],
  ["apps/shared/common.js", "admin/assets/common.js"],
  ["apps/shared/i18n.js", "admin/assets/i18n.js"],
  ["apps/shared/ui.css", "admin/assets/ui.css"],
];

for (const [source, destination] of files) {
  await copyFile(resolve(repoRoot, source), resolve(output, destination));
}

for (const source of ["apps/admin/index.html", "apps/admin/mobile.html"]) {
  const destination = resolve(adminOutput, source.endsWith("mobile.html") ? "mobile.html" : "index.html");
  let html = await readFile(resolve(repoRoot, source), "utf8");
  const script = '<script src="./assets/common.js"></script>';
  if (!html.includes(script)) throw new Error(`Could not find demo injection point in ${source}`);
  html = html.replace(script, `<script src="./demo-api.js"></script>\n${script}`);
  if (source.endsWith("index.html")) {
    const startup = 'window.addEventListener("load", () => showPage("overview")); // pages.js подключается в конце страницы';
    const demoStartup = 'window.addEventListener("load", () => { const clientsButton = $(\'.nav-item[data-page="clients"]\'); if (clientsButton) setActive(clientsButton); showPage("clients"); });';
    if (!html.includes(startup)) throw new Error("Could not find the admin startup handler");
    html = html.replace(startup, demoStartup);
  }
  await writeFile(destination, html);
}

console.log(`Demo site built in ${output}`);
