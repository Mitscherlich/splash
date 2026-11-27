import { CommandRegistry } from '../shell/registry';
import { catCommand } from './cat';
import { cdCommand } from './cd';
import { clearCommand } from './clear';
import { echoCommand } from './echo';
import { envCommand, exportCommand, unsetCommand } from './env';
import { helpCommand } from './help';
import { lsCommand } from './ls';
import { manCommand } from './man';
import { openCommand } from './open';
import { vimCommand } from './vim';

export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(lsCommand);
  registry.register(cdCommand);
  registry.register(openCommand);
  registry.register(vimCommand);
  registry.register(catCommand);
  registry.register(echoCommand);
  registry.register(exportCommand);
  registry.register(unsetCommand);
  registry.register(envCommand);
  registry.register(clearCommand);
  registry.register(helpCommand);
  registry.register(manCommand);
  return registry;
}
