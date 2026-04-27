import { getDatabase } from '../storage.js';

export async function search(args) {
  const keyword = args[0];
  if (!keyword) {
    console.error('Usage: taskr search <keyword>');
    process.exit(1);
  }

  const escaped = keyword.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const db = getDatabase();
  const rows = db.prepare("SELECT id, title, status FROM tasks WHERE title COLLATE NOCASE LIKE ? ESCAPE '\\'").all(`%${escaped}%`);
  db.close();

  if (rows.length === 0) {
    console.log(`No matches for: ${keyword}`);
    return;
  }

  for (const row of rows) {
    const checkbox = row.status === 'done' ? '[x]' : '[ ]';
    console.log(`${checkbox} ${row.id} — ${row.title}  (${row.status})`);
  }
}
