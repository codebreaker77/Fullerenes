import { EventEmitter } from 'node:events';
import chokidar, { type FSWatcher } from 'chokidar';
import { createProjectIgnoreMatcher, detectLanguage, indexProject, type IndexResult } from 'fullerenes-core';

export interface DaemonOptions {
  debounceMs?: number;
  regenerateConfig?: boolean;
  onRegenerateConfig?: (result: IndexResult) => Promise<void> | void;
  onIndexed?: (result: IndexResult) => void;
  onError?: (error: Error) => void;
}

export interface Daemon {
  stop(): void;
  getStatus(): { watching: boolean; lastIndexed: Date | null; queueSize: number };
  on(event: 'indexed', listener: (result: IndexResult) => void): this;
  on(event: 'regenerated', listener: (result: IndexResult) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'ready', listener: () => void): this;
}

class FullerenesDaemon extends EventEmitter implements Daemon {
  private readonly rootDir: string;
  private readonly options: Required<Pick<DaemonOptions, 'debounceMs' | 'regenerateConfig'>> &
    Pick<DaemonOptions, 'onIndexed' | 'onError' | 'onRegenerateConfig'>;
  private readonly watcher: FSWatcher;
  private readonly isIgnored: ReturnType<typeof createProjectIgnoreMatcher>;
  private debounceTimer: NodeJS.Timeout | null = null;
  private indexing = false;
  private rerunRequested = false;
  private watching = true;
  private lastIndexed: Date | null = null;
  private pendingPaths = new Set<string>();
  private signalHandlersBound = false;
  private readonly handleSignal = () => {
    void this.stop();
  };

  constructor(rootDir: string, options?: DaemonOptions) {
    super();
    this.rootDir = rootDir;
    this.options = {
      debounceMs: options?.debounceMs ?? 1000,
      regenerateConfig: options?.regenerateConfig ?? true,
      onRegenerateConfig: options?.onRegenerateConfig,
      onIndexed: options?.onIndexed,
      onError: options?.onError,
    };
    this.isIgnored = createProjectIgnoreMatcher(rootDir, true);

    this.watcher = chokidar.watch(rootDir, {
      ignored: (targetPath, stats) => this.isIgnored(targetPath, stats?.isDirectory() ?? false),
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher
      .on('add', (path) => this.enqueue(path))
      .on('change', (path) => this.enqueue(path))
      .on('unlink', (path) => this.enqueue(path))
      .on('ready', () => this.emit('ready'))
      .on('error', (error) => this.handleError(error instanceof Error ? error : new Error(String(error))));

    this.bindSignals();
  }

  getStatus() {
    return {
      watching: this.watching,
      lastIndexed: this.lastIndexed,
      queueSize: this.pendingPaths.size + (this.indexing ? 1 : 0),
    };
  }

  stop(): void {
    if (!this.watching) {
      return;
    }

    this.watching = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.pendingPaths.clear();
    this.unbindSignals();
    void this.watcher.close();
  }

  private enqueue(path: string) {
    if (this.isIgnored(path)) {
      return;
    }

    const language = detectLanguage(path);
    if (!language) {
      return;
    }

    this.pendingPaths.add(path);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runIndex();
    }, this.options.debounceMs);
  }

  private async runIndex(): Promise<void> {
    if (this.indexing) {
      this.rerunRequested = true;
      return;
    }

    this.indexing = true;
    this.pendingPaths.clear();

    try {
      const result = await indexProject(this.rootDir, {
        incremental: true,
        onError: (_file, error) => this.handleError(error),
      });

      this.lastIndexed = new Date();
      if (this.options.regenerateConfig && result.nodesAdded + result.nodesRemoved > 5) {
        await this.options.onRegenerateConfig?.(result);
        this.emit('regenerated', result);
      }
      this.emit('indexed', result);
      this.options.onIndexed?.(result);
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.indexing = false;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        void this.runIndex();
      }
    }
  }

  private handleError(error: Error) {
    this.emit('error', error);
    this.options.onError?.(error);
  }

  private bindSignals() {
    if (this.signalHandlersBound) {
      return;
    }

    process.on('SIGINT', this.handleSignal);
    process.on('SIGTERM', this.handleSignal);
    this.signalHandlersBound = true;
  }

  private unbindSignals() {
    if (!this.signalHandlersBound) {
      return;
    }

    process.off('SIGINT', this.handleSignal);
    process.off('SIGTERM', this.handleSignal);
    this.signalHandlersBound = false;
  }
}

export function startDaemon(rootDir: string, options?: DaemonOptions): Daemon {
  return new FullerenesDaemon(rootDir, options);
}

export const VERSION = '0.1.4';
