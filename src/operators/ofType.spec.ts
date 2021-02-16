import { IEvent } from '../interfaces'
import { Subject } from 'rxjs'
import { ofType } from './ofTtype'

describe('operators/ofType', () => {
    class A {}
    class B {}
    class C {}
    class SubA extends A {}

    let stream: Subject<any>
    let output: IEvent[]
    let expectedResults: IEvent[]

    beforeEach(() => {
        stream = new Subject()
        output = []
        expectedResults = []

        stream.pipe(ofType(A)).subscribe((event) => output.push(event))
    })

    it('filters all the events when none is an instance of the given types', async () => {
        stream.next(new B())
        stream.next(new C())
        stream.next(new B())

        expect(output).toEqual([])
    })

    it('filters instances of events to keep those of the given types', async () => {
        const event = { name: 'A', event: 'value' }
        expectedResults.push(event)

        stream.next(new B())
        stream.next(...expectedResults)
        stream.next(new Date())

        expect(output).toEqual([event.event])
    })

    it('does not filter instances of classes extending the given types', async () => {
        const event = { name: 'A', event: 'value' }
        expectedResults.push(event, new SubA())

        stream.next(new B())
        expectedResults.forEach((event) => stream.next(event))

        expect(output).toEqual([event.event])
    })
})
