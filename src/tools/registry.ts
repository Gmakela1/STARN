import { ToolDefinition } from '../openrouter/types.js';
import { ToolExecutionContext, ToolExecutionResponse, ToolHandler } from './types.js';
import { fsReadHandler } from './handlers/fs-read.js';
import { fsWriteHandler } from './handlers/fs-write.js';
import { fsEditHandler } from './handlers/fs-edit.js';
import { fsListHandler } from './handlers/fs-list.js';
import { stateReadHandler } from './handlers/state-read.js';
import { stateUpdateHandler } from './handlers/state-update.js';
import { exampleReaderHandler } from './handlers/example-reader.js';
import { webSearchHandler } from './handlers/web-search.js';
import { webFetchHandler } from './handlers/web-fetch.js';
import { docTranscribeHandler } from './handlers/doc-transcribe.js';

export interface ToolRegistryOptions {
  /** When false, document transcription tools are not registered at all. */
  transcriptionEnabled?: boolean;
}

export class ToolRegistry {
  private handlers: Map<string, ToolHandler> = new Map();

  constructor(options: ToolRegistryOptions = {}) {
    this.register(fsReadHandler);
    this.register(fsWriteHandler);
    this.register(fsEditHandler);
    this.register(fsListHandler);
    this.register(stateReadHandler);
    this.register(stateUpdateHandler);
    this.register(exampleReaderHandler);
    this.register(webSearchHandler);
    this.register(webFetchHandler);
    if (options.transcriptionEnabled !== false) {
      this.register(docTranscribeHandler);
    }
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
