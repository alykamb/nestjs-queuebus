import { Type } from '@nestjs/common'
import { Observable } from 'rxjs'
import { filter } from 'rxjs/operators'

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
): (source: Observable<TInput>) => Observable<TInput> {
    const isInstanceOf = (event: any): event is TInput => {
        return !!types.find((classType) => {
            const m: string = Reflect.getMetadata(EVENTS_METADATA, classType)
            return event.data.name === classType.name && m === event.from.name
        })
    }

    return (source: Observable<TInput>): Observable<TInput> => source.pipe(filter(isInstanceOf))
}
