/**
 * Callback with job result
 * @param err - true if data is an error, false otherwise
 * @param data - returning data, can be an Error object
 * @param completed - true if the job completed, always true for single result jobs,
 * otherwise it is false until the observable on the other side completes
 */
export type Callback<TRet = any> = (err: boolean, data: TRet | Error, completed: boolean) => void
