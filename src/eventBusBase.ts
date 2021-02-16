import {
    EVENTBUS_QUEUEBUS_METADATA,
    EVENTS_HANDLER_METADATA,
    SAGA_METADATA,
} from './decorators/constants'
import { IEvent, IEventBus, IEventHandler, ISaga } from './interfaces'
import { Inject, Injectable, OnModuleDestroy, Type } from '@nestjs/common'
import { InvalidSagaException } from './exceptions'
import { ModuleRef } from '@nestjs/core'
import { Observable, Subscription, EMPTY, of } from 'rxjs'
import { PubEvent } from './interfaces/events/jobEvent.interface'
import { RedisPubSub } from './pubsub/pubsub'
import { catchError, filter, switchMap, withLatestFrom } from 'rxjs/operators'
import { QueueBusBase } from '.'
import { IQueue } from './interfaces/queues/queue.interface'
import { IQueueJob } from './interfaces/queues/queueJob.interface'
import { QUEUE_CONFIG_SERVICE } from './constants'
import { IQueueConfigService } from './interfaces/queueConfigService.interface'
import { InvalidQueueBusForEventBusException } from './exceptions/invalidQueueBusForEventBus.exception'
import { asObservable } from './helpers/asObservable'

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
    constructor(
        protected readonly moduleRef: ModuleRef,
        @Inject(QUEUE_CONFIG_SERVICE) protected readonly queueConfig: IQueueConfigService,
        /**
         * O publisher é responsável por publicar os eventos na rede
         * e ouvir aos eventos publicados por outras instâncias
         */
        protected publisher: RedisPubSub,
    ) {
        const prototype = Object.getPrototypeOf(this)
        const queueBus = Reflect.getMetadata(EVENTBUS_QUEUEBUS_METADATA, prototype.constructor)
        if (!queueBus) {
            throw new InvalidQueueBusForEventBusException(prototype.name)
        }
        this.queueBus = this.moduleRef.get(queueBus)
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

        this.publisher.publish({ event, name, timestamp, module })
    }

    /**
     * Registra o evento e cria um subscription para executar o handler
     * cada vez que o evento for publicado na rede (sempre é através do pub$)
     *
     * @param handler - handler do evento
     * @param name - nome do evento
     */
    protected bind(handler: IEventHandler<EventBase>, name: string): void {
        this.handlers.set(name, handler)

        const subscription = this.publisher.pub$
            .pipe(
                filter((e) => {
                    return e.name === name
                }),
            )
            .subscribe((e) => {
                this.handlers.get(name).handle(e.event)
            })

        this.subscriptions.push(subscription)
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
                return metadata.data.map((key: string) => ({
                    call: instance[key],
                    name: key,
                    bus: metadata.bus,
                }))
            })
            .reduce((a, b) => a.concat(b), [])

        sagas.forEach((saga: { call: ISaga<PubEvent>; name: string; bus: QueueBusBase }) =>
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
        eventsNames.map((event) => this.bind(instance as IEventHandler<EventBase>, event.name))
    }

    /**
     * Registra as sagas
     *
     * Recebe o nome e a instância da saga. Chama a instância passando o stream de eventos
     * e executa o command resultante.
     *
     * @param saga
     */
    protected registerSaga(saga: { call: ISaga<IEvent>; name: string }): void {
        if (typeof saga.call !== 'function') {
            throw new InvalidSagaException()
        }
        const stream$ = saga.call(this.publisher.stream$) as Observable<IQueueJob>

        if (!(stream$ instanceof Observable)) {
            throw new InvalidSagaException()
        }

        const subscription = stream$
            .pipe(
                //Filtra os commands resultantes que existem
                filter((e) => {
                    return !!e
                }),

                //combina com o próprio evento atual
                withLatestFrom(this.publisher.stream$),
                switchMap(([command, event]) => {
                    let c: IQueue = command
                    let logErrors = false
                    const jobOptions = command.options?.jobOptions || {}
                    const module = command.options?.module

                    if (command.job) {
                        c = command.job
                        logErrors = command.options?.logErrors ?? false
                    }
                    const commandName = this.queueBus.getConstructorName(c as any)

                    //usa o evento atual para criar um id único
                    const jobId = `${saga.name}_${commandName}_${event.timestamp}`

                    //executa o commando e captura os erros
                    return asObservable(this.queueBus
                        .execute(c, {
                            moveToQueue: true,
                            jobOptions: { ...jobOptions, jobId },
                            module,
                        })
                    )
                        .pipe(
                            catchError((err) => {
                                if (logErrors) {
                                    // eslint-disable-next-line no-console
                                    console.error({ err, jobId })
                                }
                                return of(err)
                            }),
                        )
                }),
            )
            .subscribe((result) => {
                console.log('eventExecuted: %o', result)
                //erros de eventos não precisam parar a aplicação
            })

        //registra a subscription para removê-la depois
        this.subscriptions.push(subscription)
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
    protected reflectEventsNames(handler: EventHandlerType<EventBase>): FunctionConstructor[] {
        return Reflect.getMetadata(EVENTS_HANDLER_METADATA, handler)
    }
}
