/**
 * Thrown when the transport fails to respond in time
 */
export class TimeoutException extends Error {
    constructor(destination: string, jobName: string, jobData: any, time: number) {
        super(
            `Queue ${destination} failed to respond in time (${time}) the command ${jobName} with the data: ${JSON.stringify(
                jobData,
            )}`,
        )
    }
}
