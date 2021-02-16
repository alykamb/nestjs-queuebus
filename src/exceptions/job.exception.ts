/**
 * Excessão genérica de erro ao executar um trabalho.
 * Usado para padronizar os objetos de erro, e transmitilos através do bull como uma string
 */
export class JobException<T = any> extends Error {
    constructor(message: string, public extra: T) {
        super(message)
    }
}
