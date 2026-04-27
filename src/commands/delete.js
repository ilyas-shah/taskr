import { loadTasks, saveTasks } from '../storage.js';

export async function deleteTask(args) {
  const id = args[0];

  if (id === undefined) {
    console.error('Usage: taskr delete <id>');
    process.exit(1);
  }

  const tasks = await loadTasks();
  const task = tasks.find((task) => String(task.id) === String(id));

  if (!task) {
    console.error(`Task ${id} not found.`);
    process.exit(1);
  }

  const filteredTasks = tasks.filter((task) => String(task.id) !== String(id));
  await saveTasks(filteredTasks);
  console.log(`Deleted: ${task.title}`);
}
