// Boot xray-core (VLESS + WS) inside a Node PaaS app.
// Edge terminates TLS (platform HTTPS), xray serves plain WS on $PORT.
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn, execFileSync } = require("child_process");

const PORT = parseInt(process.env.PORT || "8080", 10);
const UUID = process.env.UUID || "de04add9-26e6-4d7b-bbb2-6d28c1f2f6a1";
const WS_PATH = process.env.WS_PATH || "/velixir-ws";
const XRAY_VER = "v1.8.24";
const DIR = __dirname;
const BIN = path.join(DIR, "xray");

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const go = (u) => https.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) return go(res.headers.location);
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on("finish", () => out.close(resolve));
    }).on("error", reject);
    go(url);
  });
}

async function ensureXray() {
  if (fs.existsSync(BIN)) return;
  const zip = path.join(DIR, "xray.zip");
  console.log("downloading xray " + XRAY_VER);
  await download(`https://github.com/XTLS/Xray-core/releases/download/${XRAY_VER}/Xray-linux-64.zip`, zip);
  const AdmZip = require("adm-zip");
  new AdmZip(zip).extractAllTo(DIR, true);
  fs.chmodSync(BIN, 0o755);
  fs.unlinkSync(zip);
  console.log("xray ready");
}

function writeConfig() {
  const cfg = {
    log: { loglevel: "warning" },
    inbounds: [{
      port: PORT,
      protocol: "vless",
      settings: { clients: [{ id: UUID }], decryption: "none" },
      streamSettings: { network: "ws", wsSettings: { path: WS_PATH } }
    }],
    outbounds: [{ protocol: "freedom" }]
  };
  fs.writeFileSync(path.join(DIR, "config.json"), JSON.stringify(cfg, null, 2));
}

(async () => {
  await ensureXray();
  writeConfig();
  const child = spawn(BIN, ["run", "-config", path.join(DIR, "config.json")], { stdio: "inherit" });
  child.on("exit", (c) => { console.log("xray exited", c); process.exit(c || 1); });
  process.on("SIGTERM", () => child.kill("SIGTERM"));
})();
