"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSaveQueue = createSaveQueue;
function createSaveQueue() {
    let queue = Promise.resolve();
    return (operation) => {
        const run = queue.then(operation, operation);
        queue = run.catch(() => undefined);
        return run;
    };
}
//# sourceMappingURL=saveQueue.js.map