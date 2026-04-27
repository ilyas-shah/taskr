import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const storageDir = join(homedir(), '.taskr');
const storageFile = join(storageDir, 'tasks.json');

export async function loadTasks() {
  try {
    const contents = await readFile(storageFile, 'utf8');
    return JSON.parse(contents);
  } catch {
    return [];
  }
}

export async function saveTasks(tasks) {
  await mkdir(storageDir, { recursive: true });
  await writeFile(storageFile, JSON.stringify(tasks, null, 2), 'utf8');
}
