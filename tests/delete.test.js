import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Runs `node src/index.js <args>` with TASKR_DB_PATH pointed at a temp database.
 *
 * Returns a Promise that resolves to { exitCode, stdout, stderr }.
 */
function runTaskr(args, tempDb) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, '..', 'src', 'index.js'), ...args],
      {
        env: { ...process.env, TASKR_DB_PATH: tempDb },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

/**
 * Seeds tasks directly into the temp SQLite database.
 */
function seedTasks(tempDb, tasks) {
  const db = new DatabaseSync(tempDb);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      title TEXT,
      status TEXT,
      created_at TEXT
    )
  `);

  const insert = db.prepare('INSERT INTO tasks (id, title, status, created_at) VALUES (?, ?, ?, ?)');
  for (const task of tasks) {
    insert.run(task.id, task.title, task.status, task.createdAt);
  }

  db.close();
}

/**
 * Reads tasks from the temp SQLite database.
 */
function readStoredTasks(tempDb) {
  const db = new DatabaseSync(tempDb);
  const rows = db.prepare('SELECT id, title, status, created_at FROM tasks').all();
  db.close();

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
  }));
}

/**
 * Adds a task via the CLI and returns the stored task object (with numeric id).
 */
async function addTaskAndGetId(tempDb, title) {
  await runTaskr(['add', title], tempDb);
  const tasks = readStoredTasks(tempDb);
  return tasks.find((task) => task.title === title);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let tempDir;
let tempDb;

beforeEach(() => {
  // Each test gets a completely isolated temp database.
  tempDir = mkdtempSync(join(tmpdir(), 'taskr-delete-test-'));
  tempDb = join(tempDir, 'tasks.db');
});

// --- Happy path ---

test('delete: removes the targeted task and prints confirmation', async () => {
  const seeded = await addTaskAndGetId(tempDb, 'Buy milk');
  const taskId = seeded.id; // numeric from storage

  const { exitCode, stdout } = await runTaskr(['delete', String(taskId)], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');
  assert.match(stdout.trim(), /Deleted: Buy milk/, 'should print "Deleted: <title>"');

  const tasks = readStoredTasks(tempDb);
  const stillPresent = tasks.find((task) => task.id === taskId);
  assert.equal(stillPresent, undefined, 'deleted task should no longer be in storage');
});

// --- ID type mismatch: id stored as Number, argv delivers a String ---

test('delete: correctly matches numeric storage id given as string argument', async () => {
  const numericId = 1700000000010;
  await seedTasks(tempDb, [
    { id: numericId, title: 'String-id delete task', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  // argv always provides strings; String(numericId) simulates that.
  const { exitCode, stdout } = await runTaskr(['delete', String(numericId)], tempDb);

  assert.equal(exitCode, 0, 'should exit 0 when id matches after String() coercion');
  assert.match(stdout, /Deleted: String-id delete task/);

  const tasks = readStoredTasks(tempDb);
  assert.equal(tasks.length, 0, 'task should be gone from storage');
});

// --- Missing id argument ---

test('delete: exits with code 1 and prints usage when no id is provided', async () => {
  const { exitCode, stderr } = await runTaskr(['delete'], tempDb);

  assert.equal(exitCode, 1, 'should exit with code 1');
  assert.match(stderr, /Usage: taskr delete <id>/, 'should print usage hint to stderr');
});

// --- Task not found ---

test('delete: exits with code 1 and prints "not found" when id does not exist', async () => {
  await seedTasks(tempDb, [
    { id: 1700000000011, title: 'A different task', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const nonExistentId = '9999999999998';
  const { exitCode, stderr } = await runTaskr(['delete', nonExistentId], tempDb);

  assert.equal(exitCode, 1, 'should exit with code 1 for missing task');
  assert.match(stderr, new RegExp(`Task ${nonExistentId} not found\\.`), 'should name the missing id');
});

// --- Cold storage (no tasks.json at all) ---

test('delete: exits with code 1 when storage file does not exist (cold start)', async () => {
  // tempDb has no .taskr directory — loadTasks returns [] → not found path.
  const { exitCode, stderr } = await runTaskr(['delete', '1234567890001'], tempDb);

  assert.equal(exitCode, 1, 'should exit 1 when storage is empty');
  assert.match(stderr, /not found/, 'should print "not found" message');
});

// --- delete removes only the targeted task, leaving others intact ---

test('delete: removes only the targeted task; sibling tasks remain untouched', async () => {
  const targetId  = 1700000000012;
  const siblingId = 1700000000013;
  await seedTasks(tempDb, [
    { id: targetId,  title: 'Delete me',    status: 'pending', createdAt: new Date().toISOString() },
    { id: siblingId, title: 'Keep me alive', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['delete', String(targetId)], tempDb);
  assert.equal(exitCode, 0);
  assert.match(stdout, /Deleted: Delete me/);

  const tasks = readStoredTasks(tempDb);
  assert.equal(tasks.length, 1, 'exactly one task should remain');
  assert.equal(tasks[0].id, siblingId, 'sibling should be the surviving task');
  assert.equal(tasks[0].title, 'Keep me alive');
});

// --- delete the only task leaves an empty array ---

test('delete: deleting the last task leaves storage with an empty array', async () => {
  const numericId = 1700000000014;
  await seedTasks(tempDb, [
    { id: numericId, title: 'Last task', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode } = await runTaskr(['delete', String(numericId)], tempDb);
  assert.equal(exitCode, 0);

  const tasks = readStoredTasks(tempDb);
  assert.equal(tasks.length, 0, 'storage should hold an empty array after deleting the last task');
});

// --- delete removes only one task when duplicate titles exist ---

test('delete: deletes only the task with the matching id, even when titles are duplicated', async () => {
  const firstId  = 1700000000015;
  const secondId = 1700000000016;
  await seedTasks(tempDb, [
    { id: firstId,  title: 'Duplicate', status: 'pending', createdAt: new Date().toISOString() },
    { id: secondId, title: 'Duplicate', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode } = await runTaskr(['delete', String(firstId)], tempDb);
  assert.equal(exitCode, 0);

  const tasks = readStoredTasks(tempDb);
  assert.equal(tasks.length, 1, 'only one of the two duplicates should be removed');
  assert.equal(tasks[0].id, secondId, 'the surviving task should have the non-deleted id');
});

// --- delete a done task ---

test('delete: can delete a task that is already marked done', async () => {
  const numericId = 1700000000017;
  await seedTasks(tempDb, [
    { id: numericId, title: 'Finished chore', status: 'done', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['delete', String(numericId)], tempDb);

  assert.equal(exitCode, 0, 'should be able to delete a done task');
  assert.match(stdout, /Deleted: Finished chore/);

  const tasks = readStoredTasks(tempDb);
  assert.equal(tasks.length, 0, 'done task should be removed from storage');
});

// --- delete via add-then-delete integration ---

test('delete: task added via add command can be deleted and disappears from list', async () => {
  const seeded = await addTaskAndGetId(tempDb, 'Integration delete task');
  const taskId = seeded.id;

  await runTaskr(['delete', String(taskId)], tempDb);

  const { stdout } = await runTaskr(['list'], tempDb);
  assert.ok(
    !stdout.includes('Integration delete task'),
    'deleted task title should not appear in list output'
  );
});
