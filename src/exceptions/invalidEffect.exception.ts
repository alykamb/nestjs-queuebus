/**
 * Excessão de quando uma Saga não retorna um Observable
 */
export class InvalidEffectException extends Error {
    constructor() {
        super(`Invalid effect exception`)
    }
}
