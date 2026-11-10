// 打包后给 .app 做 ad-hoc 重签：CI 上没有 Developer ID 证书，
// 但 electron-builder 在 CSC_IDENTITY_AUTO_DISCOVERY=false 时会跳过签名，
// 结果 app 只有 linker-signed 签名，macOS 报「已损坏」。
const { execFileSync } = require("node:child_process");

exports.default = async function afterPack(context) {
  if (process.platform !== "darwin") return;
  const app = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
};
