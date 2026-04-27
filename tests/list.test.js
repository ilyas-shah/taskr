import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Runs `node src/index.js <args>` with HOME pointed at a temp directory.
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
 * Writes a tasks.json directly into the temp home's .taskr directory.
 * This lets us set up precise fixture data without going through `add`.
 */
async function seedTasks(homeDir, tasks) {
  const taskrDir = join(homeDir, '.taskr');
  await mkdir(taskrDir, { recursive: true });
  await writeFile(join(taskrDir, 'tasks.json'), JSON.stringify(tasks, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let tempHome;

beforeEach(async () => {
  // Each test gets a completely isolated home directory.
  tempHome = await mkdtemp(join(tmpdir(), 'taskr-list-test-'));
});

// Note: individual test cleanups are handled by beforeEach creating a fresh
// tempHome each time; the old directories are left for the OS to sweep, but
// since they are in tmpdir() that is acceptable.  If strict cleanup is needed,
// an `after` hook that collects all dirs can be added.

// --- Empty state ---

test('list: prints "No tasks yet." when storage file does not exist', async () => {
  // tempHome is brand new — no .taskr directory at all.
  const { exitCode, stdout } = await runTaskr(['list'], tempHome);

  assert.equal(exitCode, 0, 'should exit with code 0');
  assert.equal(stdout.trim(), 'No tasks yet.', 'should print exactly the empty message');
});

test('list: prints "No tasks yet." when tasks.json exists but is empty array', async () => {
  await seedTasks(tempHome, []);

  const { exitCode, stdout } = await runTaskr(['list'], tempHome);

  assert.equal(exitCode, 0);
  assert.equal(stdout.trim(), 'No tasks yet.');
});

// --- Pending task format ---

test('list: displays a pending task with correct format', async () => {
  const fixedId = 1700000000000;
  await seedTasks(tempHome, [
    { id: fixedId, title: 'Buy groceries', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['list'], tempHome);

  assert.equal(exitCode, 0);
  // Expected format: "[ ] <id> — <title>  (<status>)"
  const expectedLine = `[ ] ${fixedId} — Buy groceries  (pending)`;
  assert.ok(
    stdout.includes(expectedLine),
    `stdout should contain "${expectedLine}", got:\n${stdout}`
  );
});

// --- Done task format ---

test('list: displays a done task with [x] checkbox', async () => {
  const fixedId = 1700000001000;
  await seedTasks(tempHome, [
    { id: fixedId, title: 'Write tests', status: 'done', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['list'], tempHome);

  assert.equal(exitCode, 0);
  const expectedLine = `[x] ${fixedId} — Write tests  (done)`;
  assert.ok(
    stdout.includes(expectedLine),
    `stdout should contain "${expectedLine}", got:\n${stdout}`
  );
});

// --- Mixed pending and done tasks ---

test('list: shows both pending and done tasks in insertion order', async () => {
  const idPending = 1700000002000;
  const idDone    = 1700000003000;

  await seedTasks(tempHome, [
    { id: idPending, title: 'Pending task', status: 'pending', createdAt: new Date().toISOString() },
    { id: idDone,    title: 'Done task',    status: 'done',    createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['list'], tempHome);

  assert.equal(exitCode, 0);

  const lines = stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 2, 'should print exactly 2 lines for 2 tasks');

  assert.ok(lines[0].includes('[ ]') && lines[0].includes('Pending task'));
  assert.ok(lines[1].includes('[x]') && lines[1].includes('Done task'));
});

// --- Multiple pending tasks ---

test('list: shows all pending tasks when there are several', async () => {
  const tasks = [
    { id: 1700000010000, title: 'Alpha', status: 'pending', createdAt: new Date().toISOString() },
    { id: 1700000010001, title: 'Beta',  status: 'pending', createdAt: new Date().toISOString() },
    { id: 1700000010002, title: 'Gamma', status: 'pending', createdAt: new Date().toISOString() },
  ];
  await seedTasks(tempHome, tasks);

  const { exitCode, stdout } = await runTaskr(['list'], tempHome);

  assert.equal(exitCode, 0);

  const lines = stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 3, 'should print one line per task');

  for (const task of tasks) {
    const expectedLine = `[ ] ${task.id} — ${task.title}  (pending)`;
    assert.ok(stdout.includes(expectedLine), `missing line: "${expectedLine}"`);
  }
});

// --- Task added via `add` command shows up in `list` ---

test('list: tasks added via add command appear in list output', async () => {
  await runTaskr(['add', 'Integration task'], tempHome);

  const { exitCode, stdout } = await runTaskr(['list'], tempHome);

  assert.equal(exitCode, 0);
  assert.ok(stdout.includes('Integration task'), 'task title should appear in list output');
  assert.ok(stdout.includes('[ ]'), 'newly added task should show pending checkbox');
  assert.ok(stdout.includes('(pending)'), 'newly added task status should be pending');
});

// --- Row format: em dash and double space before status ---

test('list: row uses em dash (—) separator and double space before status', async () => {
  const fixedId = 1700000020000;
  await seedTasks(tempHome, [
    { id: fixedId, title: 'Format check', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['list'], tempHome);

  assert.equal(exitCode, 0);

  // Verify the exact em-dash character and the double space before the status.
  assert.ok(stdout.includes('—'), 'row should contain em dash (—)');
  assert.ok(stdout.includes('  (pending)'), 'row should have double space before status');
});

// --- Storage edge case: malformed tasks.json is handled gracefully ---
// (loadTasks returns [] on any read error, so list should say "No tasks yet.")

test('list: treats unreadable/malformed tasks.json as empty task list', async () => {
  const taskrDir = join(tempHome, '.taskr');
  await mkdir(taskrDir, { recursive: true });
  // Write invalid JSON so JSON.parse will throw inside loadTasks.
  await writeFile(join(taskrDir, 'tasks.json'), '{ this is not valid JSON }', 'utf8');

  const { exitCode, stdout } = await runTaskr(['list'], tempHome);

  assert.equal(exitCode, 0, 'should not crash on malformed storage');
  assert.equal(stdout.trim(), 'No tasks yet.');
});
