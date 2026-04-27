import { test, before, after, beforeEach } from 'node:test';
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let tempDir;
let tempDb;

beforeEach(() => {
  // Each test gets a fresh temp directory and database for complete isolation.
  tempDir = mkdtempSync(join(tmpdir(), 'taskr-add-test-'));
  tempDb = join(tempDir, 'tasks.db');
});

after(() => {
  // Best-effort cleanup of any leftover temp dirs.
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- Happy path ---

test('add: saves task with correct shape', async () => {
  const { exitCode, stdout } = await runTaskr(['add', 'Buy milk'], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');
  assert.match(stdout.trim(), /Added: Buy milk/, 'should print confirmation');

  const tasks = readStoredTasks(tempDb);
  assert.equal(tasks.length, 1, 'should have exactly 1 task');

  const task = tasks[0];
  assert.equal(task.title, 'Buy milk', 'title should match');
  assert.equal(task.status, 'pending', 'status should default to pending');
  assert.ok(typeof task.id === 'number', 'id should be a number');
  assert.ok(typeof task.createdAt === 'string', 'createdAt should be a string');
  // Verify createdAt is a valid ISO date
  assert.ok(!Number.isNaN(Date.parse(task.createdAt)), 'createdAt should be a valid ISO date');
});

test('add: title with multiple words is stored as a single string', async () => {
  const { exitCode } = await runTaskr(['add', 'Write', 'the', 'report'], tempDb);

  assert.equal(exitCode, 0);

  const tasks = readStoredTasks(tempDb);
  assert.equal(tasks[0].title, 'Write the report');
});

// --- Missing input ---

test('add: exits with code 1 when no title is provided', async () => {
  const { exitCode, stderr } = await runTaskr(['add'], tempDb);

  assert.equal(exitCode, 1, 'should exit with code 1');
  assert.match(stderr, /Usage: taskr add <title>/, 'should print usage to stderr');
});

test('add: exits with code 1 when title is only whitespace', async () => {
  // Shell would normally collapse whitespace, but we pass a literal space arg.
  const { exitCode, stderr } = await runTaskr(['add', '   '], tempDb);

  assert.equal(exitCode, 1, 'should exit with code 1 for whitespace-only title');
  assert.match(stderr, /Usage: taskr add <title>/);
});

// --- Multiple adds accumulate ---

test('add: multiple adds accumulate all tasks in storage', async () => {
  await runTaskr(['add', 'Task one'], tempDb);
  await runTaskr(['add', 'Task two'], tempDb);
  await runTaskr(['add', 'Task three'], tempDb);

  const tasks = readStoredTasks(tempDb);

  assert.equal(tasks.length, 3, 'should have 3 tasks after 3 adds');
  const titles = tasks.map((task) => task.title);
  assert.deepEqual(titles, ['Task one', 'Task two', 'Task three']);
});

test('add: each task gets a unique id', async () => {
  // Small delay between spawns is unavoidable when id = Date.now(); we run
  // them sequentially and check uniqueness rather than assuming ordering.
  await runTaskr(['add', 'Alpha'], tempDb);
  await runTaskr(['add', 'Beta'], tempDb);

  const tasks = readStoredTasks(tempDb);
  const ids = tasks.map((task) => task.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, tasks.length, 'all task ids should be unique');
});

// --- Storage: database/table created automatically ---

test('add: creates database and table if they do not exist', async () => {
  // tempDb does not exist yet — add should create it.
  const { exitCode } = await runTaskr(['add', 'Bootstrap test'], tempDb);

  assert.equal(exitCode, 0);

  // If the file is readable, the database was created.
  const tasks = readStoredTasks(tempDb);
  assert.equal(tasks.length, 1);
});

// --- Storage: loadTasks returns [] when database does not exist ---

test('storage: a fresh database yields an empty task list on list', async () => {
  // We indirectly test loadTasks returning [] by running `list` on a brand-new
  // database that has no tasks.
  const { exitCode, stdout } = await runTaskr(['list'], tempDb);

  assert.equal(exitCode, 0);
  assert.match(stdout.trim(), /No tasks yet\./);
});

// --- Duplicate titles are allowed (no de-dup constraint in the spec) ---

test('add: allows duplicate titles', async () => {
  await runTaskr(['add', 'Duplicate task'], tempDb);
  await runTaskr(['add', 'Duplicate task'], tempDb);

  const tasks = readStoredTasks(tempDb);
  assert.equal(tasks.length, 2, 'both duplicates should be saved');
  assert.equal(tasks[0].title, tasks[1].title);
});
