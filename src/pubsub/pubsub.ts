import { EVENT_PATTERN, QUEUE_CONFIG_SERVICE } from '../constants'
import { IEventPublisher } from '../interfaces'
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { Observable, Subject, Subscription } from 'rxjs'
import { PubEvent } from '../interfaces/events/jobEvent.interface'
import { IQueueConfigService } from '../interfaces/queueConfigService.interface'

/**
 * O publisher é responsável por enviar e receber eventos na rede
 * Ele centraliza esses eventos em observables que podem ser usados
 * pelo EventBus
 */
@Injectable()
export class RedisPubSub<EventBase extends PubEvent = PubEvent>
    implements IEventPublisher<EventBase>, OnModuleDestroy {
    /** Pub são os eventos publicados deste módulo para a rede */
    public pub$ = new Subject<PubEvent>()

    /** Sub são os eventos recebidos da rede */
    public sub$ = new Subject<PubEvent>()

    /** Mantem a subscription para ser removida ao módulo ser destruído */
    private subscription: Subscription

    constructor(@Inject(QUEUE_CONFIG_SERVICE) private readonly queueConfig: IQueueConfigService) {
        this.subscription = this.pub$.subscribe((pubEvent) => {
            this.queueConfig.clientProxy.emit(EVENT_PATTERN, pubEvent)
        })
    }

    public get stream$(): Observable<PubEvent> {
        return this.sub$
    }

    /** Publica o evento para a rede */
    public publish<T extends EventBase>(event: T): void {
        this.pub$.next(event)
    }

    /** Recebe o evento da rede */
    public receive<T extends EventBase>(event: T): void {
        this.sub$.next(event)
    }

    public onModuleDestroy(): void {
        this.subscription?.unsubscribe()
    }
}
