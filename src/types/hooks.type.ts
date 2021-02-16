import { Observable } from 'rxjs'

export type Hook = (arg?: any) => any | Observable<any> | Promise<any>
