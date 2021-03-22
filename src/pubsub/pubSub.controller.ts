import { Body, Controller } from '@nestjs/common'
import { EventPattern } from '@nestjs/microservices'

import { EVENT_PATTERN } from '../constants'
import { PubEvent } from '../interfaces/events/jobEvent.interface'
import { RedisPubSub } from './pubsub'

/**
 * Este controller é responsável por receber todos os eventos
 * publicados na rede, e mandar para o publisher para que
 * as sagas possam ouvir e gerenciar, se necessário
 */
@Controller('__internal_pubsub__')
export class PubSubController {
    constructor(private publisher: RedisPubSub) {}

    @EventPattern(EVENT_PATTERN)
    public newEvent(@Body() event: PubEvent): void {
        this.publisher.receive(event)
    }
}
