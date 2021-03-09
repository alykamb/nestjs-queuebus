import { Observable } from 'rxjs'
export type Hook = (arg?: any, handler?: any, cb?: (d: any) =>  any | Observable<any> | Promise<any>

) => any | Observable<any> | Promise<any>
