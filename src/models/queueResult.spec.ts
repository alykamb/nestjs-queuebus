import { catchError, EMPTY, filter, toArray } from 'rxjs'

import { QueueResult } from './queueResult'

jest.setTimeout(20000)

describe('QueueResult', () => {
    let queue: QueueResult<number>
    let errorQueue: QueueResult<number>
    const error = new Error('Result is 5')

    beforeEach(() => {
        queue = new QueueResult<number>((observer) => {
            let i = 0
            const interval = setInterval(() => {
                observer.next(i++)
                if (i === 10) {
                    observer.complete()
                }
            }, 200)

            return (): void => clearInterval(interval)
        })

        errorQueue = new QueueResult<number>((observer) => {
            let i = 0
            const interval = setInterval(() => {
                observer.next(i++)
                if (i === 10) {
                    observer.complete()
                }

                if (i === 5) {
                    observer.error(error)
                }
            }, 200)

            return (): void => clearInterval(interval)
        })
    })

    it('should be subscribable', (done) => {
        let previousI = -1
        queue.subscribe({
            next: (i) => {
                expect(i).toBe(previousI + 1)
                previousI = i
            },
            complete: done,
        })
    })

    it('should be pipeable', (done) => {
        queue
            .pipe(
                filter((i) => i % 2 === 0),
                toArray(),
            )
            .subscribe({ next: (v) => expect(v).toStrictEqual([0, 2, 4, 6, 8]), complete: done })
    })

    it('should be thenable', (done) => {
        void queue.then((i) => {
            expect(i).toBe(9)
            done()
        })
    })

    it('should be awaitable', async () => {
        const i = await queue
        expect(i).toBe(9)
    })

    it('should catch error on the catchError pipe function', (done) => {
        errorQueue
            .pipe(
                catchError((err) => {
                    expect(err).toBe(error)
                    return EMPTY
                }),
            )
            .subscribe({ complete: done })
    })

    it('should catch error on the subscription error callback function', (done) => {
        errorQueue.subscribe({
            complete: done,
            error: (err) => {
                expect(err).toBe(error)
                done()
            },
        })
    })

    it('should catch error on the .catch function', (done) => {
        void errorQueue.catch((err) => {
            expect(err).toBe(error)
            done()
        })
    })

    // test.todo('should keep the last value before completion')
})
