import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function resolveDataFile(dataDir, fileName) {
  return join(dataDir, fileName);
}

export async function readJsonFile(path, fallback) {
  try {
    const raw = await readFile(path, 'utf8');
    if (!raw.trim()) return structuredClone(fallback);
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

export async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function todayDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export function requireText(value, fieldName) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${fieldName} is required`);
  return text;
}

export function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function parseDate(value, fieldName = 'date') {
  const text = requireText(value, fieldName);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error(`${fieldName} must use YYYY-MM-DD`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    throw new Error(`${fieldName} is invalid`);
  }

  return text;
}

export function updateById(items, id, update) {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`Item not found: ${id}`);
  items[index] = update(items[index]);
  return items[index];
}
