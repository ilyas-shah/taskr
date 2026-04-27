import { loadTasks, saveTasks } from '../storage.js';

export async function done(args) {
  const id = args[0];

  if (id === undefined) {
    console.error('Usage: taskr done <id>');
    process.exit(1);
  }

  const tasks = await loadTasks();
  const task = tasks.find((task) => String(task.id) === String(id));

  if (!task) {
    console.error(`Task ${id} not found.`);
    process.exit(1);
  }

  task.status = 'done';
  await saveTasks(tasks);
  console.log(`Done: ${task.title}`);
}
