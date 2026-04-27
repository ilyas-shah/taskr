import { loadTasks } from '../storage.js';

export async function list() {
  const tasks = await loadTasks();

  if (tasks.length === 0) {
    console.log('No tasks yet.');
    return;
  }

  for (const task of tasks) {
    const checkbox = task.status === 'done' ? '[x]' : '[ ]';
    console.log(`${checkbox} ${task.id} — ${task.title}  (${task.status})`);
  }
}
