export const QUEUE_HANDLER_METADATA = Symbol()
export const EVENTS_METADATA = Symbol()
export const EFFECT_METADATA = Symbol()
export const NAME_QUEUE_METADATA = Symbol()

//job execution
export const JOB_BEFORE_EXECUTION_METADATA = Symbol() //beforeExecution: Hook[]
export const JOB_AFTER_EXECUTION_METADATA = Symbol() //afterExecution: Hook[]
export const JOB_EXECUTION_INTERSEPTOR_METADATA = Symbol() //exectionInterceptor: Hook[]

// //job execution stream
// export const JOB_BEFORE_EXECUTION_STREAM_METADATA = Symbol() //beforeExecutionStream: Hook[]
// export const JOB_AFTER_EXECUTION_STREAM_METADATA = Symbol() //afterExecutionStream: Hook[]
// export const JOB_EXECUTION_STREAM_INTERSEPTION_METADATA = Symbol() //exectionInterceptorStream: Hook[]

//job transmission
export const JOB_BEFORE_TRANSMISSION_METADATA = Symbol() //beforeTransmission: Hook[]
export const JOB_AFTER_TRANSMISSION_METADATA = Symbol() //afterTransmission: Hook[]
export const JOB_TRANSMISSION_INTERSEPTOR_METADATA = Symbol() //transmissionInterceptor: Hook[]

// //job transmission stream
// export const JOB_BEFORE_TRANSMISSION_STREAM_METADATA = Symbol() //beforeTransmissionStream: Hook[]
// export const JOB_AFTER_TRANSMISSION_STREAM_METADATA = Symbol() //afterTransmissionStream: Hook[]
// export const JOB_TRANSMISSION_STREAM_INTERSEPTION_METADATA = Symbol() //transmissionInterceptorStream: Hook[]

//evet publish
export const EVENT_BEFORE_PUBLISH_METADATA = Symbol()
export const EVENT_AFTER_PUBLISH_METADATA = Symbol()

//effects
export const EFFECT_BEFORE_EXECUTION_METADATA = Symbol()
export const EFFECT_AFTER_EXECUTION_METADATA = Symbol()
export const EFFECT_INTERSEPTION_EXECUTION_METADATA = Symbol()
//when a event is received
export const EVENT_ON_RECEIVE_METADATA = Symbol()

//register
export const HANDLER_REGISTER_METADATA = Symbol()
export const EFFECT_REGISTER_METADATA = Symbol()
