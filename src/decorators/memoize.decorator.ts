function compareArgs(args1: any[], args2: any[]): boolean {
    //se o tamanho é diferente, já pode retornar false, os dois são diferentes
    if (args1.length !== args2.length) {
        return false
    }
    //agora compara cada um deles
    for (let i = 0; i < args1.length; i++) {
        //se pelo menos um deles for diferente, pode retornar false e interromper o for
        if (args1[i] !== args2[i]) {
            return false
        }
    }
    //se chegou aqui, quer dizer que todos são iguais
    return true
}

export const memoize = (): MethodDecorator => (
    _target: any,
    _propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<any>,
): TypedPropertyDescriptor<any> => {
    const oldValue = descriptor.value
    let previousArgs: any[]
    let result: any

    descriptor.value = function (...args: any[]): void {
        if (result && previousArgs && compareArgs(previousArgs, args)) {
            return result
        }

        result = oldValue.apply(this, args)
        previousArgs = args
        return result
    }
    return descriptor
}
