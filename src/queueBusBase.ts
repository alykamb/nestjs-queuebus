import { Inject, Injectable, Type } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { Job } from 'bullmq'

import { BullMq } from './bullmq/bullMq'
import { MESSAGE_BROOKER, QUEUE_CONFIG_SERVICE } from './constants'
import {
    JOB_AFTER_EXECUTION_METADATA,
    JOB_BEFORE_EXECUTION_METADATA,
    JOB_INTERSECTION_EXECUTION_METADATA,
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
import { IImpl } from './interfaces/queues/queueImpl.interface'
import { Hook, HookContext } from './types/hooks.type'

export type HandlerType = Type<IQueueHandler<IImpl>>

const compose = (
    ...funcs: Array<((...args: any[]) => any | Promise<any>) | false | undefined | null>
) => (data: Promise<any> | any): Promise<any> =>
    funcs.reduce(
        async (value, func) => (func && typeof func === 'function' && func(await value)) || value,
        data,
    )

/**
 * CqrsBus registra handlers para implementações e os executa quando chamado
 */
@Injectable()
export class QueueBusBase<ImplBase = any> implements IQueueBus<ImplBase> {
    protected handlers = new Map<string, IQueueHandler<ImplBase>>()
    protected metadataName = QUEUE_HANDLER_METADATA
    protected name = ''

    protected hooks: IJobExecutionInterceptors

    constructor(
        protected readonly moduleRef: ModuleRef,
        @Inject(MESSAGE_BROOKER) protected readonly bullMq: BullMq,
        @Inject(QUEUE_CONFIG_SERVICE) protected readonly queueConfig: IQueueConfigService,
    ) {
        this.name =
            Reflect.getMetadata(NAME_QUEUE_METADATA, Object.getPrototypeOf(this).constructor) || ''

        void this.bullMq.createWorker(this.queueConfig.name + this.name, (job: Job) =>
            this.handleJob(job),
        )
    }

    /**
     * Executa o handler registrado para a implementação de
     * acordo com o nome da classe
     *
     * @param impl - implementação
     * @param [options] - opções para criação do command
     */
    public execute<Ret = any, T extends ImplBase = ImplBase>(
        impl: T,
        options: IExecutionOptions = {},
    ): Promise<Ret> {
        const implName = this.getConstructorName(impl as any)
        return this.executeByName(implName, impl, options)
    }

    /**
     * Executa o handler registrado para a implementação de
     * acordo com o nome
     *
     * @param name - nome do comando
     * @param data - dados que serão passados ao execute do handler
     * @param [options] - opções para criação do command
     */
    protected executeByName<Ret, T extends ImplBase = ImplBase>(
        name: string,
        data: T,
        options: IExecutionOptions = {},
    ): Promise<Ret> {
        const { moveToQueue = false, module = this.queueConfig.name, jobOptions } = options

        const run = (name: string, d: T): Promise<Ret> => {
            if (module === this.queueConfig.name && this.handlers.has(name) && !moveToQueue) {
                return this.executeHandler(name, d)
            }
            return new Promise((resolve, reject) => {
                this.bullMq.addJob(
                    module + this.name,
                    name,
                    d,
                    (err, data) => {
                        if (err) {
                            return reject(err)
                        }
                        return resolve(data)
                    },
                    jobOptions,
                )
            })
        }

        const hooks = this.getHooks()

        return compose(
            hooks.before && this.runHooks(hooks.before, { name, module, bus: this }),
            hooks.interceptor.length
                ? this.runHooks(hooks.interceptor, { name, module, data, bus: this }, (d) =>
                      run(name, d),
                  )
                : (data): Promise<any> => run(name, data),
            hooks.after && this.runHooks(hooks.after, { name, module, bus: this }),
        )(data)
    }

    /**
     * Usa a instância do handler com o nome do command salvá-lo como referência,
     * criar a queue do BullMq e criar o worker que vai executar o handler caso
     * o command venha pelo redis no BullMq (provavelmente de outro serviço na rede)
     *
     * @param handler - handler que vai executar o command
     * @param name - nome do command
     */
    protected bind<T extends ImplBase>(handler: IQueueHandler<T>, name: string): void {
        this.handlers.set(name, handler)
    }

    /**
     * Registra todos os handlers criados com o @decorator CommandHandler
     *
     * @param handlers - Lista de handlers
     */
    public register(handlers: HandlerType[] = []): void {
        handlers.forEach((handler) => this.registerHandler(handler))
    }

    /**
     * Faz a execução do trabalho com o handler registrado
     *
     * @param job - trabalho do bullMq
     */
    public handleJob(job: Job): Promise<any> {
        return this.executeHandler(job.name, job.data)
    }

    protected executeHandler(name: string, data: any): Promise<any> {
        if (!this.handlers.has(name)) {
            throw new InvalidQueueHandlerException(name)
        }

        const handler: IQueueHandler<ImplBase, any> & {
            eventBus?: EventBusBase
        } = this.handlers.get(name)

        try {
            const result = handler.execute(data)
            if (result?.toPromise) {
                return result.toPromise()
            }
            if (!(result instanceof Promise)) {
                return Promise.resolve(result)
            }
            return result
        } catch (err) {
            return Promise.reject(err)
        }
    }

    protected runHooks(
        hooks: Hook[],
        context: HookContext,
        cb?: (d: any) => Promise<any>,
    ): (data: any) => Promise<any> {
        return (data: any): Promise<any> =>
            hooks.reduce(async (value, func) => func({ ...context, data: await value }, cb), data)
    }

    protected getHooks(): IJobExecutionInterceptors {
        if (!this.hooks) {
            const constructor = Reflect.getPrototypeOf(this).constructor
            const map = (property: { key: string; order: number }): any =>
                this.queueConfig[property.key]
            this.hooks = {
                before: (Reflect.getMetadata(JOB_BEFORE_EXECUTION_METADATA, constructor) || [])
                    .sort(
                        (p1: { key: string; order: number }, p2: { key: string; order: number }) =>
                            p1.order - p2.order,
                    )
                    .map(map),
                after: (Reflect.getMetadata(JOB_AFTER_EXECUTION_METADATA, constructor) || [])
                    .sort(
                        (p1: { key: string; order: number }, p2: { key: string; order: number }) =>
                            p1.order - p2.order,
                    )
                    .map(map),
                interceptor: (
                    Reflect.getMetadata(JOB_INTERSECTION_EXECUTION_METADATA, constructor) || []
                )
                    .sort(
                        (p1: { key: string; order: number }, p2: { key: string; order: number }) =>
                            p1.order - p2.order,
                    )
                    .map(map),
            }
        }

        return this.hooks
    }

    /**
     * Registra o handler
     *
     * Pega a instância da classe através do ModuleRef do nest,
     * depois o nome do command através do metadado criado pelo @decorator CommandHandler
     * e passa os dois para o @function bind
     *
     * @param handler - handler decorado com CommandHandler
     */
    protected registerHandler(handler: HandlerType): void {
        const instancia = this.moduleRef.get(handler, { strict: false })
        if (!instancia) {
            return
        }
        const target = this.reflectMetadataName(handler)
        if (!target) {
            throw new InvalidQueueHandlerException()
        }
        this.bind(instancia as IQueueHandler<ImplBase>, target.data.name)
    }

    /**
     * Pega o nome da classe (que é uma função) através do construtor no prototype
     *
     * @param func
     */
    public getConstructorName<T = any>(func: T): string {
        const { constructor } = Object.getPrototypeOf(func)
        return constructor.name
    }

    /**
     * Retorna o nome registrado pelo metadata. ex: classe de impl de Command ou Query
     *
     * @param handler - instancia da classe handler
     */
    protected reflectMetadataName<T = any>(
        handler: T,
    ): { data: FunctionConstructor; bus: QueueBusBase } {
        return Reflect.getMetadata(this.metadataName, handler)
    }
}
