export const composeAsync =
    (...funcs: Array<((...args: any[]) => any | Promise<any>) | false | undefined | null>) =>
    (data: Promise<any> | any): Promise<any> =>
        funcs.reduce(
            async (value, func) =>
                (func && typeof func === 'function' && func(await value)) || value,
            data,
        )
