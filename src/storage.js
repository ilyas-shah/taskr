import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const dbPath = process.env.TASKR_DB_PATH ?? fileURLToPath(new URL('../taskr.db', import.meta.url));

export function getDatabase() {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      title TEXT,
      status TEXT,
      created_at TEXT
    )
  `);
  return db;
}

export async function loadTasks() {
  const db = getDatabase();
  const rows = db.prepare('SELECT id, title, status, created_at FROM tasks').all();
  db.close();

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function saveTasks(tasks) {
  const db = getDatabase();
  db.exec('DELETE FROM tasks');

  const insert = db.prepare('INSERT INTO tasks (id, title, status, created_at) VALUES (?, ?, ?, ?)');
  for (const task of tasks) {
    insert.run(task.id, task.title, task.status, task.createdAt);
  }

  db.close();
}
