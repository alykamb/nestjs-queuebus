import { lastValueFrom, Observable } from 'rxjs'

export class QueueResult<T = any> extends Observable<T> implements Promise<T> {
    private _promise: Promise<T>
    private _status: 'Pending' | 'Completed' | 'Failed' = 'Pending'

    public value?: T

    public get [Symbol.toStringTag](): string {
        return `Queue <${this._status}>`
    }

    private get promise(): Promise<T> {
        if (!this._promise) {
            this._promise = lastValueFrom(this)
        }
        return this._promise
    }

    public then<TResult1 = T, TResult2 = never>(
        onfulfilled?: (value: T) => TResult1 | PromiseLike<TResult1>,
        onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>,
    ): Promise<TResult1 | TResult2> {
        return this.promise.then(
            (result) => {
                this.value = result
                this._status = 'Completed'
                return onfulfilled(result)
            },
            (err) => {
                this._status = 'Failed'
                return onrejected(err)
            },
        )
    }

    public catch<TResult = never>(
        onrejected?: (reason: any) => TResult | PromiseLike<TResult>,
    ): Promise<T | TResult> {
        return this.promise.catch((err) => {
            this._status = 'Failed'
            return onrejected(err)
        })
    }

    public finally(onfinally?: () => void): Promise<T> {
        this.subscribe({ complete: onfinally })
        return this
    }
}
