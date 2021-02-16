import { isFunction } from "@nestjs/common/utils/shared.utils";
import { from, Observable, of } from "rxjs";

export function asObservable<T = any>(result: Observable<T> | Promise<T> | T): Observable<T> {
    if (result instanceof Promise) {
        return from(result)
    } else if (!(result && isFunction((result as Observable<T>).subscribe))) {
        return of(result as T)
    }
    return result as Observable<T>
}