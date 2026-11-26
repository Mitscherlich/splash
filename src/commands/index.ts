import { CommandRegistry } from '../shell/registry';
import { cdCommand } from './cd';
import { clearCommand } from './clear';
import { helpCommand } from './help';
import { lsCommand } from './ls';
import { openCommand } from './open';

export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(lsCommand);
  registry.register(cdCommand);
  registry.register(openCommand);
  registry.register(clearCommand);
  registry.register(helpCommand);
  return registry;
}
