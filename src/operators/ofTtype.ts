import { Type } from '@nestjs/common'
import { Observable } from 'rxjs'
import { filter, map } from 'rxjs/operators'

import { EVENTS_METADATA } from '../decorators/constants'
import { IEvent } from '../interfaces'

/**
 * Filter values depending on their instance type (comparison is made
 * using native `instanceof`).
 *
 * @param types List of types implementing `IEvent`.
 *
 * @return A stream only emitting the filtered instances.
 */
export function ofType<TInput extends IEvent, TOutput extends IEvent>(
    ...types: Array<Type<TOutput>>
): (source: Observable<TInput>) => Observable<TOutput> {
    const isInstanceOf = (event: any): event is TOutput => {
        return !!types.find((classType) => {
            const m: string = Reflect.getMetadata(EVENTS_METADATA, classType)
            return event.name === classType.name && m === event.module
        })
    }

    return (source: Observable<TInput>): Observable<TOutput> =>
        source.pipe(
            filter(isInstanceOf),
            map((e: any) => e.event),
        )
}
