import { Hook } from '../types/hooks.type'

export interface IJobExecutionInterceptors {
    beforeExecution: Hook[]
    afterExecution: Hook[]
    exectionInterceptor: Hook[]
    // beforeExecutionStream: Hook[]
    // afterExecutionStream: Hook[]
    // exectionStreamInterceptor: Hook[]
    beforeTransmission: Hook[]
    afterTransmission: Hook[]
    transmissionInterceptor: Hook[]
    // beforeTransmissionStream: Hook[]
    // afterTransmissionStream: Hook[]
    // transmissionStreamInterceptor: Hook[]
}
