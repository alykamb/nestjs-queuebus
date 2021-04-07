import { Inject, Injectable, OnModuleDestroy, Type } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { noop, Observable, Subscription } from 'rxjs'

import { QueueBusBase } from '.'
import { MESSAGE_BROOKER, QUEUE_CONFIG_SERVICE } from './constants'
import {
    EVENT_AFTER_EXECUTION_METADATA,
    EVENT_AFTER_PUBLISH_METADATA,
    EVENT_BEFORE_EXECUTION_METADATA,
    EVENT_BEFORE_PUBLISH_METADATA,
    EVENT_ON_RECEIVE_METADATA,
    EVENTBUS_QUEUEBUS_METADATA,
    EVENTS_HANDLER_METADATA,
    SAGA_AFTER_EXECUTION_METADATA,
    SAGA_BEFORE_EXECUTION_METADATA,
    SAGA_METADATA,
} from './decorators/constants'
import { InvalidSagaException } from './exceptions'
import { InvalidQueueBusForEventBusException } from './exceptions/invalidQueueBusForEventBus.exception'
import { compose } from './helpers/compose'
import { IEvent, IEventBus, IEventHandler, ISaga } from './interfaces'
import { IEventExecutionInterceptors } from './interfaces/eventExecutionInterceptors.interface'
import { PubEvent } from './interfaces/events/jobEvent.interface'
import { IQueueConfigService } from './interfaces/queueConfigService.interface'
import { ITransport } from './interfaces/transport.interface'
import { Hook, HookContext } from './types/hooks.type'
import { SagaData } from './types/sagaData.type'

export type EventHandlerType<EventBase extends IEvent = IEvent> = Type<IEventHandler<EventBase>>

/**
 * Registra os handlers para as implementações de eventos.
 *
 * Executa handlers somente para eventos locais.
 * Eventos da rede passam somente pelas sagas
 */
@Injectable()
export class EventBusBase<EventBase extends IEvent = IEvent>
    implements IEventBus<EventBase>, OnModuleDestroy {
    /**
     * Guarda referência de todos os handlers registrados
     */
    protected handlers = new Map<string, IEventHandler>()
    /**
     * Mantem referência de todas subscrições para desativá-las.
     */
    protected readonly subscriptions: Subscription[] = []
    protected queueBus: QueueBusBase
    protected hooks: IEventExecutionInterceptors
    constructor(
        protected readonly moduleRef: ModuleRef,
        @Inject(QUEUE_CONFIG_SERVICE) protected readonly queueConfig: IQueueConfigService,
        @Inject(MESSAGE_BROOKER) protected readonly transport: ITransport,
    ) {
        const prototype = Object.getPrototypeOf(this)
        const queueBus = Reflect.getMetadata(EVENTBUS_QUEUEBUS_METADATA, prototype.constructor)
        if (!queueBus) {
            throw new InvalidQueueBusForEventBusException(prototype.name)
        }
        this.queueBus = this.moduleRef.get(queueBus)

        this.transport.registerEventListener(prototype.name, (event: PubEvent) => {
            const hooks = this.getHooks()
            if (hooks.eventOnReceive) {
                void this.runHooks(hooks.eventOnReceive, {
                    name: event.name,
                    module: event.module,
                    bus: this,
                })(event).catch(noop)
            }
        })
    }

    /**
     * Remove as subscriptions criadas
     */
    public onModuleDestroy(): void {
        this.subscriptions.forEach((subscription) => subscription.unsubscribe())
    }

    /**
     * Publica o evento
     *
     * Assina com o timestamp da hora que ele foi publicado, para evitar que sagas iguais
     * criem comandos duplicados
     * E adiciona o nome, para que outras sagas na rede possam identificar o evento.
     *
     * @param event - evento que será publicado
     */
    public publish<T extends EventBase>(event: T): void {
        const name = this.getEventName(event as any)
        const timestamp = +new Date()
        const module = this.queueConfig.name

        const hooks = this.getHooks()

        void compose(
            hooks.eventBeforePublish &&
                this.runHooks(hooks.eventBeforePublish, { name, module, bus: this }),
            (data) => {
                void this.transport.publishEvent(data).catch(noop)
                return data
            },
            hooks.eventAfterPublish &&
                this.runHooks(hooks.eventAfterPublish, { name, module, bus: this }),
        )({
            event,
            name,
            timestamp,
            module,
            queueName: this.queueBus['fullname'],
        })

        const handler = this.handlers.get(name)
        if (handler) {
            try {
                const res = compose(
                    hooks.eventBeforeExecution &&
                        this.runHooks(hooks.eventBeforeExecution, { name, module, bus: this }),
                    (data) => this.parseHook(handler.handle(data)),
                    hooks.eventAfterExecution &&
                        this.runHooks(hooks.eventAfterPublish, { name, module, bus: this }),
                )(event)

                if (res instanceof Promise) {
                    res.catch(() => {
                        //
                    })
                }
            } catch (err) {}
        }
    }

    /**
     * Registra o evento handler
     *
     * @param handler - handler do evento
     * @param name - nome do evento
     */
    protected bind(handler: IEventHandler<EventBase>, name: string): void {
        this.handlers.set(name, handler)
    }

    /**
     * Registra as sagas encontradas pelo decorador Saga
     *
     * @param types
     */
    public registerSagas(types: Array<Type<unknown>> = []): void {
        const sagas = types
            .map((target) => {
                const metadata = Reflect.getMetadata(SAGA_METADATA, target) || []
                const instance: { [key: string]: ISaga<PubEvent> } = this.moduleRef.get(target, {
                    strict: false,
                })
                if (!instance) {
                    throw new InvalidSagaException()
                }

                return metadata.data.map(
                    (arg: { key: string; events: IEvent[]; name: string }) => ({
                        call: instance[arg.key],
                        key: arg.key,
                        bus: metadata.bus,
                        name: arg.name,
                        events: arg.events,
                    }),
                )
            })
            .reduce((a, b) => a.concat(b), [])

        sagas.forEach((saga: { call: ISaga<PubEvent>; bus: QueueBusBase } & SagaData) =>
            this.registerSaga(saga),
        )
    }

    /**
     * Registra os handlers encontrados
     *
     * @param handlers
     */
    public register(handlers: Array<EventHandlerType<EventBase>> = []): void {
        handlers.forEach((handler) => this.registerHandler(handler))
    }

    /**
     * Busca o nome de cada handler e o registra.
     *
     * @param handler
     */
    protected registerHandler(handler: EventHandlerType<EventBase>): void {
        const instance = this.moduleRef.get(handler, { strict: false })
        if (!instance) {
            return
        }
        const eventsNames = this.reflectEventsNames(handler)

        eventsNames.data.map((event) => this.bind(instance as IEventHandler<EventBase>, event.name))
    }

    protected getHooks(): IEventExecutionInterceptors {
        const sort = (
            p1: { key: string; order: number },
            p2: { key: string; order: number },
        ): number => p1.order - p2.order

        if (!this.hooks) {
            const constructor = Reflect.getPrototypeOf(this).constructor
            const map = (property: { key: string; order: number }): any =>
                this.queueConfig[property.key]
            this.hooks = {
                eventBeforeExecution: (
                    Reflect.getMetadata(EVENT_BEFORE_EXECUTION_METADATA, constructor) || []
                )
                    .sort(sort)
                    .map(map),
                eventAfterExecution: (
                    Reflect.getMetadata(EVENT_AFTER_EXECUTION_METADATA, constructor) || []
                )
                    .sort(sort)
                    .map(map),
                eventOnReceive: (Reflect.getMetadata(EVENT_ON_RECEIVE_METADATA, constructor) || [])
                    .sort(sort)
                    .map(map),
                eventBeforePublish: (
                    Reflect.getMetadata(EVENT_BEFORE_PUBLISH_METADATA, constructor) || []
                )
                    .sort(sort)
                    .map(map),
                eventAfterPublish: (
                    Reflect.getMetadata(EVENT_AFTER_PUBLISH_METADATA, constructor) || []
                )
                    .sort(sort)
                    .map(map),
                sagaBeforeExecution: (
                    Reflect.getMetadata(SAGA_BEFORE_EXECUTION_METADATA, constructor) || []
                )
                    .sort(sort)
                    .map(map),
                sagaAfterExecution: (
                    Reflect.getMetadata(SAGA_AFTER_EXECUTION_METADATA, constructor) || []
                )
                    .sort(sort)
                    .map(map),
            }
        }

        return this.hooks
    }

    protected runHooks(
        hooks: Hook[],
        context: HookContext,
        cb?: (d: any) => Promise<any>,
    ): (data: any) => Promise<any> {
        return (data: any): Promise<any> =>
            hooks.reduce(
                async (value, func) => func({ ...context, data: await this.parseHook(value) }, cb),
                data,
            )
    }

    protected parseHook(value: any | Promise<any> | Observable<any>): Promise<any> | any {
        if (value && typeof value.subscribe === 'function') {
            return value.toPromise()
        }
        return value
    }

    /**
     * Registra as sagas
     *
     * Recebe o nome e a instância da saga. Chama a instância passando o stream de eventos
     * e executa o command resultante.
     *
     * @param saga
     */
    protected registerSaga(saga: { call: ISaga<PubEvent>; bus: QueueBusBase } & SagaData): void {
        if (typeof saga.call !== 'function') {
            throw new InvalidSagaException()
        }

        //cria o nome com a combinação de events
        const name = `${saga.name}_${saga.key}_${saga.events.map((t) => t.name).join()}`

        this.transport.registerSaga(
            this.queueBus['fullname'],
            name,
            (data: { event: PubEvent }): void => {
                const hooks = this.getHooks()

                void compose(
                    hooks.sagaBeforeExecution &&
                        this.runHooks(hooks.sagaBeforeExecution, { name, module, bus: this }),
                    async (data) => {
                        try {
                            await this.parseHook(saga.call(data.event))
                        } catch (err) {}
                    },
                    hooks.sagaAfterExecution &&
                        this.runHooks(hooks.sagaAfterExecution, { name, module, bus: this }),
                )(data)
            },
            ...saga.events,
        )
    }

    /**
     * Retorna o nome do evento através do protótipo da classe
     * @param event
     */
    protected getEventName(event: EventBase): string {
        const { constructor } = Object.getPrototypeOf(event)
        return constructor.name as string
    }

    /**
     * Retorna o valor do metadado, que é a implementação do evento
     * @param handler
     */
    protected reflectEventsNames(
        handler: EventHandlerType<EventBase>,
    ): { data: FunctionConstructor[]; bus: Type<EventBusBase> } {
        return Reflect.getMetadata(EVENTS_HANDLER_METADATA, handler)
    }
}
