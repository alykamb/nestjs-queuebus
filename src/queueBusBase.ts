import { Inject, Injectable, Type } from '@nestjs/common'
import { isFunction } from '@nestjs/common/utils/shared.utils'
import { ModuleRef } from '@nestjs/core'
import { Job } from 'bullmq'
import { Observable } from 'rxjs'

import {
    MESSAGE_BROOKER,
    QUEUE_CONFIG_SERVICE,
    QUEUE_DEFAULT_NAME,
    ResultType,
    TIMEOUT,
} from './constants'
import {
    JOB_AFTER_EXECUTION_METADATA,
    JOB_AFTER_TRANSMISSION_METADATA,
    JOB_BEFORE_EXECUTION_METADATA,
    JOB_BEFORE_TRANSMISSION_METADATA,
    JOB_EXECUTION_INTERSEPTOR_METADATA,
    JOB_TRANSMISSION_INTERSEPTOR_METADATA,
    NAME_QUEUE_METADATA,
    QUEUE_HANDLER_METADATA,
} from './decorators/constants'
import { EventBusBase } from './eventBusBase'
import { InvalidQueueHandlerException } from './index'
import { IExecutionOptions } from './interfaces/executionOptions.interface'
import { IJobExecutionInterceptors } from './interfaces/jobExecutionInterceptors.interface'
import { IQueueConfigService } from './interfaces/queueConfigService.interface'
import { IQueueBus } from './interfaces/queues/queueBus.interface'
import { IQueueHandler } from './interfaces/queues/queueHandler.interface'
import { ITransport } from './interfaces/transport.interface'
import { CommandType, StreamCommand } from './models/command'
// import { composeAsync } from './helpers/compose'
import { HooksService } from './services/hooks.service'

export type HandlerType = Type<IQueueHandler>

/**
 * CqrsBus registra handlers para implementações e os executa quando chamado
 */
@Injectable()
export class QueueBusBase implements IQueueBus {
    protected handlers = new Map<string, IQueueHandler>()
    protected metadataName = QUEUE_HANDLER_METADATA
    protected timeout = TIMEOUT
    public name = ''

    constructor(
        protected readonly moduleRef: ModuleRef,
        @Inject(MESSAGE_BROOKER) protected readonly messageBrooker: ITransport,
        @Inject(QUEUE_CONFIG_SERVICE) protected readonly queueConfig: IQueueConfigService,
        @Inject(QUEUE_DEFAULT_NAME) name = '',
        protected readonly hooksService: HooksService<IJobExecutionInterceptors>,
    ) {
        this.name =
            Reflect.getMetadata(NAME_QUEUE_METADATA, Object.getPrototypeOf(this).constructor) ||
            name

        void this.messageBrooker.createWorker(this.queueConfig.name + this.name, (job: Job) =>
            this.handleJob(job),
        )
    }

    /**
     * Executes the command
     *
     * If @param options.projectName is different from the current projectName,
     * the command will be called remotely
     *
     * if @param options.projectName is absent or equal to the current projectName,
     * the command will run locally
     *
     * if @param options.moveToQueue is true, the command will always run remotely
     */
    public execute<T extends CommandType = CommandType>(
        command: T,
        options: IExecutionOptions = {},
    ): T[ResultType] {
        const constructor = this.getConstructor(command as any)
        return this.executeByName<T>(
            constructor.name,
            command,
            options,
            command instanceof StreamCommand,
        )
    }

    /**
     * Executes the registered handler for the command name
     */
    protected executeByName<T extends CommandType = CommandType>(
        jobName: string,
        data: T,
        remoteCommandOptions: IExecutionOptions = {},
        isStream = false,
    ): T[ResultType] {
        const {
            moveToQueue = false,
            projectName = this.queueConfig.name,
            ...o
        } = remoteCommandOptions

        const queueName = projectName + this.name

        const finalOptions = {
            timeout: this.timeout,
            ...(o || {}),
        }

        // if it is the current project, and does not need to move to the queue, runs locally
        if (projectName === this.queueConfig.name && this.handlers.has(jobName) && !moveToQueue) {
            return this.executeHandler<T>(jobName, data)
        }

        if (isStream) {
            return this.runStream(queueName, jobName, data, finalOptions)
        }
        return this.run(queueName, jobName, data, finalOptions)
    }

    /**
     * Runs a remote command which will return data once
     */
    protected run<T extends CommandType = CommandType>(
        queueName: string,
        jobname: string,
        data: any,
        remoteCommandOptions: IExecutionOptions = {},
    ): T[ResultType] {
        // const hooks = this.getHooks()
        // const context = { name: jobname, projectName: options.projectName, bus: this }

        // const run = (name: string, d: T): T[ResultType] => {

        return new Promise((resolve, reject) => {
            this.messageBrooker.addJob(
                queueName,
                jobname,
                data,
                (err, data) => {
                    if (err) {
                        reject(err)
                        return
                    }
                    resolve(data)
                },
                remoteCommandOptions,
            )
        })
        // }

        // return composeAsync(
        //     hooks.beforeExecution && this.runHooks(hooks.beforeExecution, context),
        //     hooks.exectionInterceptor.length
        //         ? this.runHooks(hooks.exectionInterceptor, { ...context, data }, (d) =>
        //               run(jobname, d),
        //           )
        //         : // if no interceptor hooks exist, we just run the command
        //           (data): Promise<any> => run(jobname, data),
        //     hooks.afterExecution && this.runHooks(hooks.afterExecution, context),
        // )(data)
    }

    /**
     * Runs a remote command which will return an stream of data, which may or may not be completed
     * on the future
     */
    protected runStream<T extends StreamCommand<any> = StreamCommand<any>>(
        queueName: string,
        jobName: string,
        data: any,
        options: IExecutionOptions = {},
    ): T[ResultType] {
        // const hooks = this.getHooks()
        // const context = { name: jobname, projectName: options.projectName, bus: this }

        // const run = (name: string, d: T): T[ResultType] => {

        return new Observable((observer) => {
            this.messageBrooker.addJob(
                queueName,
                jobName,
                data,
                (err, data, completed) => {
                    if (err) {
                        observer.error(data)
                        observer.complete()
                        return
                    }
                    observer.next(data)
                    if (completed) {
                        observer.complete()
                    }
                },
                options,
            )
        })
    }

    /**
     * Uses the Handler class instance, keeping a referenc to call later it's execute function
     */
    protected bind<T extends CommandType = CommandType>(
        handlerInstance: IQueueHandler<T>,
        commandName: string,
    ): void {
        this.handlers.set(commandName, handlerInstance)
    }

    /**
     * Registers all the handlers decorated with the CommandHandler @decorator for this queueBus
     *
     * @param handlersClasses - list de handlers classes
     */
    public register(handlersClasses: HandlerType[] = []): void {
        handlersClasses.forEach((handlerClass) => this.registerHandler(handlerClass))
    }

    /**
     * Handles a job that came from the worker
     */
    public handleJob(job: Job): CommandType[ResultType] {
        return this.executeHandler(job.name, job.data)
    }

    /**
     * @param name name of the command
     * @param data data to pass to the execute function
     * @returns the resulting promise or observable
     */
    protected executeHandler<T extends CommandType = CommandType>(
        name: string,
        data: any,
    ): T[ResultType] {
        if (!this.handlers.has(name)) {
            throw new InvalidQueueHandlerException(name)
        }

        const handler: IQueueHandler & {
            eventBus?: EventBusBase
        } = this.handlers.get(name)

        const result = handler.execute(data)
        if (isFunction((result as Observable<any>)?.subscribe)) {
            return result
        }

        return result as Promise<any>
    }

    /**
     * Gets the registered hooks
     */
    protected getHooks(): IJobExecutionInterceptors {
        return this.hooksService.getHooks(
            {
                afterExecution: JOB_AFTER_EXECUTION_METADATA,
                afterTransmission: JOB_AFTER_TRANSMISSION_METADATA,
                beforeExecution: JOB_BEFORE_EXECUTION_METADATA,
                beforeTransmission: JOB_BEFORE_TRANSMISSION_METADATA,
                exectionInterceptor: JOB_EXECUTION_INTERSEPTOR_METADATA,
                transmissionInterceptor: JOB_TRANSMISSION_INTERSEPTOR_METADATA,
            },
            this,
        )
    }

    /**
     * Registers the handler so it's intance execute function can
     * be called later by the bus
     */
    protected registerHandler(handlerClass: HandlerType): void {
        const instance = this.moduleRef.get(handlerClass, { strict: false })
        if (!instance) {
            throw new InvalidQueueHandlerException(handlerClass?.name)
        }
        const target = this.reflectMetadataName(handlerClass)
        if (!target) {
            throw new InvalidQueueHandlerException(handlerClass?.name)
        }
        this.bind(instance as IQueueHandler, target.data.name)
    }

    /**
     * @returns the constructor of an object
     */
    public getConstructor<T = any>(obj: T): any {
        const { constructor } = Object.getPrototypeOf(obj)
        return constructor
    }

    /**
     * @returns the metadata of the queuebus of the handler
     */
    protected reflectMetadataName<T = any>(
        handler: T,
    ): { data: FunctionConstructor; bus: QueueBusBase } {
        return Reflect.getMetadata(this.metadataName, handler)
    }
}
