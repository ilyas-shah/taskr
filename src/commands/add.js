import { loadTasks, saveTasks } from '../storage.js';

export async function add(args) {
  const title = args.join(' ').trim();
  if (!title) {
    console.error('Usage: taskr add <title>');
    process.exit(1);
  }

  const tasks = await loadTasks();
  const newTask = {
    id: Date.now(),
    title,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  tasks.push(newTask);
  await saveTasks(tasks);
  console.log(`Added: ${title}`);
}
