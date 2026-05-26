import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { normalize } from 'node:path';

export function existingFile(path) {
  try {
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

export function execText(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', timeout: 3000 }).trim();
  } catch {
    return '';
  }
}

export function wherePaths(name) {
  if (process.platform !== 'win32') return [];
  return execText('where.exe', [name])
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
}

export function quoteWindowsArg(value) {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function spawnExecutable(executable, args, options) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/iu.test(executable)) {
    const command = [quoteWindowsArg(executable), ...args.map(quoteWindowsArg)].join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      ...options,
      windowsHide: true,
    });
  }

  return spawn(executable, args, {
    ...options,
    windowsHide: true,
  });
}

export function findExecutable(candidates) {
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const path = normalize(candidate);
    if (seen.has(path)) continue;
    seen.add(path);
    const found = existingFile(path);
    if (found) return found;
  }
  return undefined;
}

export function createDisabledSkillNotice(providerName, settings, allSkillNames) {
  const disabled = Array.isArray(settings.disabledSkills) ? settings.disabledSkills.filter(Boolean) : [];
  if (disabled.length === 0) return '';

  const known = Array.isArray(allSkillNames) && allSkillNames.length > 0
    ? disabled.filter((name) => allSkillNames.includes(name))
    : disabled;
  if (known.length === 0) return '';

  return `本轮 ${providerName} 集成已禁用这些 skills，请不要主动调用或加载它们：${known.join(', ')}。`;
}
