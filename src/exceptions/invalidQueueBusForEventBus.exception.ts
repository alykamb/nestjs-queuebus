export class InvalidQueueBusForEventBusException extends Error {
    constructor(name: string) {
        super(`Invalid queueBus for EventBus: ${name}! (missing @UseQueueBus() decorator?)`)
    }
}
