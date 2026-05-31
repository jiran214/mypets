import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const workers = new Map();

function formatTs() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function ensureDir(filePath) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {}
}

/**
 * 创建一个绑定到特定 requestId 的 logger。
 * 所有日志追加写入同一个 node.log 文件，每行带 requestId 前缀。
 */
export function createLogger(logFile, requestId) {
  ensureDir(logFile);
  const prefix = requestId ? `[${requestId}]` : "[]";

  const log = (level, module, message) => {
    const line = `[${formatTs()}] ${prefix} [${level}] [${module}] ${message}\n`;
    try {
      appendFileSync(logFile, line, "utf8");
    } catch {}
  };

  return {
    info: (module, msg) => log("INFO", module, msg),
    warn: (module, msg) => log("WARN", module, msg),
    error: (module, msg) => log("ERROR", module, msg),
  };
}
