import { ToolDefinition } from '../openrouter/types.js';
import { ToolExecutionContext, ToolExecutionResponse, ToolHandler } from './types.js';
import { fsReadHandler } from './handlers/fs-read.js';
import { fsWriteHandler } from './handlers/fs-write.js';
import { fsListHandler } from './handlers/fs-list.js';
import { stateReadHandler } from './handlers/state-read.js';
import { stateUpdateHandler } from './handlers/state-update.js';
import { exampleReaderHandler } from './handlers/example-reader.js';

export class ToolRegistry {
  private handlers: Map<string, ToolHandler> = new Map();

  constructor() {
    this.register(fsReadHandler);
    this.register(fsWriteHandler);
    this.register(fsListHandler);
    this.register(stateReadHandler);
    this.register(stateUpdateHandler);
    this.register(exampleReaderHandler);
  }

  public register(handler: ToolHandler): void {
    this.handlers.set(handler.name, handler);
  }

  public getDefinitions(allowedToolNames?: string[]): ToolDefinition[] {
    const list: ToolDefinition[] = [];
    for (const [name, handler] of this.handlers.entries()) {
      if (!allowedToolNames || allowedToolNames.includes(name)) {
        list.push(handler.definition);
      }
    }
    return list;
  }

  public async execute(
    name: string,
    args: any,
    context: ToolExecutionContext,
    allowedToolNames?: string[]
  ): Promise<ToolExecutionResponse> {
    if (allowedToolNames && !allowedToolNames.includes(name)) {
      return {
        success: false,
        error: `Tool ${name} is not permitted for the active specialist package.`
      };
    }

    const handler = this.handlers.get(name);
    if (!handler) {
      return {
        success: false,
        error: `Unknown tool: ${name}`
      };
    }

    try {
      return await handler.execute(args, context);
    } catch (err: any) {
      return {
        success: false,
        error: `Tool execution failed: ${err.message || String(err)}`
      };
    }
  }
}
