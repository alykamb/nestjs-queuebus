/**
 * Excessão de quando uma Saga não retorna um Observable
 */
export class InvalidSagaException extends Error {
    constructor() {
        super(`Invalid saga exception. Each saga should return an Observable object`)
    }
}
