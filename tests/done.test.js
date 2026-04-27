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
 * Accepts an array of task objects so we can set up precise fixture data.
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
 * Relies on `add` being tested separately; here it is used as a seeding tool.
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
  tempDir = mkdtempSync(join(tmpdir(), 'taskr-done-test-'));
  tempDb = join(tempDir, 'tasks.db');
});

// --- Happy path ---

test('done: marks a pending task as done and prints confirmation', async () => {
  const seeded = await addTaskAndGetId(tempDb, 'Write the report');
  const taskId = seeded.id; // numeric from storage

  const { exitCode, stdout } = await runTaskr(['done', String(taskId)], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');
  assert.match(stdout.trim(), /Done: Write the report/, 'should print "Done: <title>"');

  const tasks = readStoredTasks(tempDb);
  const updatedTask = tasks.find((task) => task.id === taskId);
  assert.equal(updatedTask.status, 'done', 'task status should be "done" in storage');
});

// --- ID type mismatch: id stored as Number, argv delivers a String ---

test('done: correctly matches numeric storage id given as string argument', async () => {
  // Seed directly with a known numeric id to make the mismatch explicit.
  const numericId = 1700000000001;
  await seedTasks(tempDb, [
    { id: numericId, title: 'String-id match task', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  // argv always provides strings; String(numericId) simulates that.
  const { exitCode, stdout } = await runTaskr(['done', String(numericId)], tempDb);

  assert.equal(exitCode, 0, 'should exit 0 when id matches after String() coercion');
  assert.match(stdout, /Done: String-id match task/);

  const tasks = readStoredTasks(tempDb);
  assert.equal(tasks[0].status, 'done', 'status should be updated to "done"');
});

// --- Idempotency: calling done on an already-done task ---

test('done: calling done on an already-done task is idempotent and succeeds', async () => {
  const numericId = 1700000000002;
  await seedTasks(tempDb, [
    { id: numericId, title: 'Already done task', status: 'done', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['done', String(numericId)], tempDb);

  assert.equal(exitCode, 0, 'should exit 0 even if task is already done');
  assert.match(stdout, /Done: Already done task/, 'should still print confirmation');

  const tasks = readStoredTasks(tempDb);
  assert.equal(tasks[0].status, 'done', 'status should remain "done"');
});

// --- Missing id argument ---

test('done: exits with code 1 and prints usage when no id is provided', async () => {
  const { exitCode, stderr } = await runTaskr(['done'], tempDb);

  assert.equal(exitCode, 1, 'should exit with code 1');
  assert.match(stderr, /Usage: taskr done <id>/, 'should print usage hint to stderr');
});

// --- Task not found ---

test('done: exits with code 1 and prints "not found" when id does not exist', async () => {
  await seedTasks(tempDb, [
    { id: 1700000000003, title: 'Some other task', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const nonExistentId = '9999999999999';
  const { exitCode, stderr } = await runTaskr(['done', nonExistentId], tempDb);

  assert.equal(exitCode, 1, 'should exit with code 1 for missing task');
  assert.match(stderr, new RegExp(`Task ${nonExistentId} not found\\.`), 'should name the missing id');
});

// --- Cold storage (no tasks.json at all) ---

test('done: exits with code 1 when storage file does not exist (cold start)', async () => {
  // tempDb has no .taskr directory — loadTasks returns [] → not found path.
  const { exitCode, stderr } = await runTaskr(['done', '1234567890000'], tempDb);

  assert.equal(exitCode, 1, 'should exit 1 when storage is empty');
  assert.match(stderr, /not found/, 'should print "not found" message');
});

// --- done does not remove the task, only updates status ---

test('done: task remains in storage with updated status, not removed', async () => {
  const numericId = 1700000000004;
  await seedTasks(tempDb, [
    { id: numericId, title: 'Keep me', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  await runTaskr(['done', String(numericId)], tempDb);

  const tasks = readStoredTasks(tempDb);
  assert.equal(tasks.length, 1, 'task should not be removed from storage');
  assert.equal(tasks[0].id, numericId, 'same task should still be present');
  assert.equal(tasks[0].status, 'done', 'status should be updated to done');
});

// --- done only updates the targeted task, not others ---

test('done: only the targeted task is updated; sibling tasks are unchanged', async () => {
  const targetId = 1700000000005;
  const siblingId = 1700000000006;
  await seedTasks(tempDb, [
    { id: targetId,  title: 'Target task',  status: 'pending', createdAt: new Date().toISOString() },
    { id: siblingId, title: 'Sibling task', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode } = await runTaskr(['done', String(targetId)], tempDb);
  assert.equal(exitCode, 0);

  const tasks = readStoredTasks(tempDb);
  const target  = tasks.find((task) => task.id === targetId);
  const sibling = tasks.find((task) => task.id === siblingId);

  assert.equal(target.status,  'done',    'targeted task should be done');
  assert.equal(sibling.status, 'pending', 'sibling task should remain pending');
});
