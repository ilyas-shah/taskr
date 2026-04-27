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
 * Seeds tasks into the database by spawning `add` commands.
 * This ensures we test through the CLI interface.
 */
async function seedTestTasks(tempDb, tasks) {
  for (const task of tasks) {
    await runTaskr(['add', task.title], tempDb);

    // Update the task's status and id if needed
    if (task.status === 'done' || task.id !== undefined) {
      const db = new DatabaseSync(tempDb);
      if (task.status === 'done') {
        db.prepare('UPDATE tasks SET status = ? WHERE title = ?').run('done', task.title);
      }
      if (task.id !== undefined) {
        db.prepare('UPDATE tasks SET id = ? WHERE title = ?').run(task.id, task.title);
      }
      db.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let tempDir;
let tempDb;

beforeEach(() => {
  // Each test gets a completely isolated temp database.
  tempDir = mkdtempSync(join(tmpdir(), 'taskr-search-test-'));
  tempDb = join(tempDir, 'tasks.db');
});

// --- Missing keyword argument ---

test('search: exits with code 1 and prints usage when keyword is missing', async () => {
  const { exitCode, stderr } = await runTaskr(['search'], tempDb);

  assert.equal(exitCode, 1, 'should exit with code 1');
  assert.match(stderr, /Usage: taskr search <keyword>/, 'should print usage to stderr');
});

// --- No matches ---

test('search: prints "No matches for: <keyword>" when keyword does not match any task', async () => {
  await seedTestTasks(tempDb, [
    { id: 1700000000001, title: 'Buy groceries', status: 'pending', createdAt: new Date().toISOString() },
    { id: 1700000000002, title: 'Call the dentist', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['search', 'nonexistent'], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0 even when no matches');
  assert.equal(stdout.trim(), 'No matches for: nonexistent', 'should print no matches message');
});

// --- Single match (case-insensitive) ---

test('search: finds one task with case-insensitive matching (lowercase keyword, mixed case title)', async () => {
  await seedTestTasks(tempDb, [
    { id: 1700000000003, title: 'Call the dentist', status: 'pending', createdAt: new Date().toISOString() },
    { id: 1700000000004, title: 'Buy groceries', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['search', 'call'], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');

  const expectedLine = '[ ] 1700000000003 — Call the dentist  (pending)';
  assert.ok(
    stdout.includes(expectedLine),
    `stdout should contain "${expectedLine}", got:\n${stdout}`
  );

  // Should not include the non-matching task
  assert.ok(!stdout.includes('Buy groceries'), 'should not include non-matching task');
});

test('search: finds one task with case-insensitive matching (uppercase keyword, lowercase title)', async () => {
  await seedTestTasks(tempDb, [
    { id: 1700000000005, title: 'call the dentist', status: 'pending', createdAt: new Date().toISOString() },
    { id: 1700000000006, title: 'buy groceries', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['search', 'CALL'], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');

  const expectedLine = '[ ] 1700000000005 — call the dentist  (pending)';
  assert.ok(
    stdout.includes(expectedLine),
    `stdout should contain "${expectedLine}", got:\n${stdout}`
  );
});

// --- Multiple matches ---

test('search: finds multiple tasks matching the keyword', async () => {
  await seedTestTasks(tempDb, [
    { id: 1700000000007, title: 'Buy milk', status: 'pending', createdAt: new Date().toISOString() },
    { id: 1700000000008, title: 'Buy bread', status: 'pending', createdAt: new Date().toISOString() },
    { id: 1700000000009, title: 'Call the dentist', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['search', 'buy'], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');

  // Should include both tasks with "buy"
  assert.ok(stdout.includes('Buy milk'), 'should include first matching task');
  assert.ok(stdout.includes('Buy bread'), 'should include second matching task');

  // Should not include non-matching task
  assert.ok(!stdout.includes('Call the dentist'), 'should not include non-matching task');

  // Verify output has 2 lines
  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 2, 'should have exactly 2 output lines');
});

// --- Search across pending and done tasks ---

test('search: finds tasks across both pending and done statuses with correct checkboxes', async () => {
  await seedTestTasks(tempDb, [
    { id: 1700000000010, title: 'Call the doctor', status: 'pending', createdAt: new Date().toISOString() },
    { id: 1700000000011, title: 'Call the dentist', status: 'done', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['search', 'call'], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');

  // Should show pending task with [ ]
  const pendingLine = '[ ] 1700000000010 — Call the doctor  (pending)';
  assert.ok(
    stdout.includes(pendingLine),
    `stdout should contain pending task: "${pendingLine}"`
  );

  // Should show done task with [x]
  const doneLine = '[x] 1700000000011 — Call the dentist  (done)';
  assert.ok(
    stdout.includes(doneLine),
    `stdout should contain done task: "${doneLine}"`
  );

  // Verify output has 2 lines
  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 2, 'should have exactly 2 output lines');
});

// --- Output format matches list exactly ---

test('search: output format matches list format (checkbox, id, em-dash, title, double space, status)', async () => {
  const taskId = 1700000000012;
  await seedTestTasks(tempDb, [
    { id: taskId, title: 'Format verification task', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['search', 'format'], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');

  // Verify exact format: "[ ] <id> — <title>  (<status>)"
  const expectedLine = `[ ] ${taskId} — Format verification task  (pending)`;
  assert.equal(stdout.trim(), expectedLine, 'format should exactly match list format');

  // Verify em-dash and double space
  assert.ok(stdout.includes('—'), 'should contain em dash (—)');
  assert.ok(stdout.includes('  (pending)'), 'should have double space before status');
});

test('search: done task output format uses [x] checkbox', async () => {
  const taskId = 1700000000013;
  await seedTestTasks(tempDb, [
    { id: taskId, title: 'Completed task', status: 'done', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['search', 'completed'], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');

  const expectedLine = `[x] ${taskId} — Completed task  (done)`;
  assert.equal(stdout.trim(), expectedLine, 'done task format should match list format');
});

// --- SQL special characters (% and _) ---

test('search: handles SQL wildcard % literally without treating it as wildcard', async () => {
  await seedTestTasks(tempDb, [
    { id: 1700000000014, title: 'Save 20% on groceries', status: 'pending', createdAt: new Date().toISOString() },
    { id: 1700000000015, title: 'Buy 100 items', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['search', '20%'], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');

  // Should find the task with literal 20%
  assert.ok(stdout.includes('Save 20% on groceries'), 'should match literal % character');

  // Should not match other tasks
  assert.ok(!stdout.includes('100 items'), 'should not match unrelated tasks');
});

test('search: handles SQL wildcard _ literally without treating it as single-character wildcard', async () => {
  await seedTestTasks(tempDb, [
    { id: 1700000000016, title: 'Update user_profile table', status: 'pending', createdAt: new Date().toISOString() },
    { id: 1700000000017, title: 'Update userxprofile cache', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['search', 'user_profile'], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');

  // Should find the task with literal user_profile
  assert.ok(stdout.includes('user_profile table'), 'should match literal _ character');

  // Should not match userxprofile (where _ would match any single char if treated as wildcard)
  assert.ok(!stdout.includes('userxprofile'), 'should not treat _ as wildcard');
});

// --- Partial matches (substring matching) ---

test('search: matches tasks containing keyword as substring', async () => {
  await seedTestTasks(tempDb, [
    { id: 1700000000018, title: 'Extraordinary meeting', status: 'pending', createdAt: new Date().toISOString() },
    { id: 1700000000019, title: 'Regular standup', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['search', 'ordinary'], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');

  // Should match "Extraordinary" which contains "ordinary"
  assert.ok(stdout.includes('Extraordinary meeting'), 'should match substring');

  // Should not match non-matching task
  assert.ok(!stdout.includes('Regular standup'), 'should not match unrelated task');
});

// --- Empty database ---

test('search: prints "No matches" when database is empty', async () => {
  // Database is already cleared by beforeEach

  const { exitCode, stdout } = await runTaskr(['search', 'anything'], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');
  assert.equal(stdout.trim(), 'No matches for: anything', 'should print no matches message');
});

// --- Case-insensitive edge case: mixed case keyword and title ---

test('search: matches with mixed case in both keyword and title', async () => {
  await seedTestTasks(tempDb, [
    { id: 1700000000020, title: 'CaLl ThE dEnTiSt', status: 'pending', createdAt: new Date().toISOString() },
  ]);

  const { exitCode, stdout } = await runTaskr(['search', 'CaLl'], tempDb);

  assert.equal(exitCode, 0, 'should exit with code 0');
  assert.ok(stdout.includes('CaLl ThE dEnTiSt'), 'should match case-insensitively');
});
