export type SaveOperationQueue = (operation: () => Promise<void>) => Promise<void>;

export function createSaveQueue(): SaveOperationQueue {
  let queue: Promise<unknown> = Promise.resolve();

  return (operation) => {
    const run = queue.then(operation, operation);
    queue = run.catch(() => undefined);
    return run;
  };
}
