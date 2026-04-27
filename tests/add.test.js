import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Runs `node src/index.js <args>` with HOME pointed at a temp directory so
 * that ~/.taskr resolves to a safe, isolated location.
 *
 * Returns a Promise that resolves to { exitCode, stdout, stderr }.
 */
function runTaskr(args, homeDir) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, '..', 'src', 'index.js'), ...args],
      {
        env: { ...process.env, HOME: homeDir },
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
 * Reads the tasks.json from the temp home's .taskr directory.
 */
async function readStoredTasks(homeDir) {
  const tasksFile = join(homeDir, '.taskr', 'tasks.json');
  const raw = await readFile(tasksFile, 'utf8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let tempHome;

beforeEach(async () => {
  // Each test gets a fresh temp directory so there is no state bleed.
  tempHome = await mkdtemp(join(tmpdir(), 'taskr-add-test-'));
});

after(async () => {
  // Best-effort cleanup of any leftover temp dirs.
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
  }
});

// --- Happy path ---

test('add: saves task with correct shape', async () => {
  const { exitCode, stdout } = await runTaskr(['add', 'Buy milk'], tempHome);

  assert.equal(exitCode, 0, 'should exit with code 0');
  assert.match(stdout.trim(), /Added: Buy milk/, 'should print confirmation');

  const tasks = await readStoredTasks(tempHome);
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
  const { exitCode } = await runTaskr(['add', 'Write', 'the', 'report'], tempHome);

  assert.equal(exitCode, 0);

  const tasks = await readStoredTasks(tempHome);
  assert.equal(tasks[0].title, 'Write the report');
});

// --- Missing input ---

test('add: exits with code 1 when no title is provided', async () => {
  const { exitCode, stderr } = await runTaskr(['add'], tempHome);

  assert.equal(exitCode, 1, 'should exit with code 1');
  assert.match(stderr, /Usage: taskr add <title>/, 'should print usage to stderr');
});

test('add: exits with code 1 when title is only whitespace', async () => {
  // Shell would normally collapse whitespace, but we pass a literal space arg.
  const { exitCode, stderr } = await runTaskr(['add', '   '], tempHome);

  assert.equal(exitCode, 1, 'should exit with code 1 for whitespace-only title');
  assert.match(stderr, /Usage: taskr add <title>/);
});

// --- Multiple adds accumulate ---

test('add: multiple adds accumulate all tasks in storage', async () => {
  await runTaskr(['add', 'Task one'], tempHome);
  await runTaskr(['add', 'Task two'], tempHome);
  await runTaskr(['add', 'Task three'], tempHome);

  const tasks = await readStoredTasks(tempHome);

  assert.equal(tasks.length, 3, 'should have 3 tasks after 3 adds');
  const titles = tasks.map((task) => task.title);
  assert.deepEqual(titles, ['Task one', 'Task two', 'Task three']);
});

test('add: each task gets a unique id', async () => {
  // Small delay between spawns is unavoidable when id = Date.now(); we run
  // them sequentially and check uniqueness rather than assuming ordering.
  await runTaskr(['add', 'Alpha'], tempHome);
  await runTaskr(['add', 'Beta'], tempHome);

  const tasks = await readStoredTasks(tempHome);
  const ids = tasks.map((task) => task.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, tasks.length, 'all task ids should be unique');
});

// --- Storage: directory created automatically ---

test('add: creates ~/.taskr directory if it does not exist', async () => {
  // tempHome exists but .taskr does not — add should create it.
  const { exitCode } = await runTaskr(['add', 'Bootstrap test'], tempHome);

  assert.equal(exitCode, 0);

  // If the file is readable, the directory was created.
  const tasks = await readStoredTasks(tempHome);
  assert.equal(tasks.length, 1);
});

// --- Storage: loadTasks returns [] when file does not exist ---

test('storage: a fresh home directory yields an empty task list on list', async () => {
  // We indirectly test loadTasks returning [] by running `list` on a brand-new
  // home dir that has no tasks.json.
  const { exitCode, stdout } = await runTaskr(['list'], tempHome);

  assert.equal(exitCode, 0);
  assert.match(stdout.trim(), /No tasks yet\./);
});

// --- Duplicate titles are allowed (no de-dup constraint in the spec) ---

test('add: allows duplicate titles', async () => {
  await runTaskr(['add', 'Duplicate task'], tempHome);
  await runTaskr(['add', 'Duplicate task'], tempHome);

  const tasks = await readStoredTasks(tempHome);
  assert.equal(tasks.length, 2, 'both duplicates should be saved');
  assert.equal(tasks[0].title, tasks[1].title);
});
