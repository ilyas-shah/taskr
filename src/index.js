import { add } from './commands/add.js';
import { list } from './commands/list.js';
import { done } from './commands/done.js';
import { deleteTask } from './commands/delete.js';
import { search } from './commands/search.js';

const USAGE = `
Usage: taskr <command> [args]

Commands:
  add <title>       Add a new task
  list              List all tasks
  done <id>         Mark a task as done
  delete <id>       Delete a task
  search <keyword>  Search tasks by title
`.trim();

const [, , command, ...args] = process.argv;

if (!command || command === '--help' || command === '-h') {
  console.log(USAGE);
  process.exit(0);
}

const commands = { add, list, done, delete: deleteTask, search };

if (!commands[command]) {
  console.error(`Unknown command: ${command}`);
  console.log(USAGE);
  process.exit(1);
}

await commands[command](args);
