/**
 * Excessão de quando um QueueHandler não é encontrado para um Job
 */
export class InvalidQueueHandlerException extends Error {
    constructor(command?: string) {
        super(`Invalid handler exception for impl ${command} (missing @QueueHandler() decorator?)`)
    }
}
