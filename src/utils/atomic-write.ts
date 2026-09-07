import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function writeJsonAtomic(filePath: string, payload: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(payload, null, 2);
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;

  writeFileSync(tmpPath, content, 'utf-8');
  try {
    renameSync(tmpPath, filePath);
  } catch {
    // Fallback if atomic rename across mounts or windows locks fails
    writeFileSync(filePath, content, 'utf-8');
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {}
  }
}
