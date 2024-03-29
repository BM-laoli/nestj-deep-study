/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import {
  Server,
  CustomTransportStrategy,
  ReadPacket,
} from '@nestjs/microservices';

import * as faye from 'faye';
import { ERROR_EVENT } from 'src/constants';
import { FayeContext } from '../ctx-host';
import { Observable } from 'rxjs';

export class ServerFaye extends Server implements CustomTransportStrategy {
  // Holds our client interface to the Faye broker.
  private fayeClient;

  constructor(private readonly options) {
    super();
    // super class establishes the serializer and deserializer; sets up
    // defaults unless overridden via `options`
    this.initializeSerializer(options);
    this.initializeDeserializer(options);
  }

  /**
   * listen() is required by `CustomTransportStrategy` It's called by the
   * framework when the transporter is instantiated, and kicks off a lot of
   * the machinery.
   */
  public listen(callback: () => void) {
    this.fayeClient = this.createFayeClient();
    this.start(callback);
  }

  /**
   * get and save a connection to the faye broker
   */
  public createFayeClient() {
    // pull out url, and strip serializer and deserializer properties
    // from options so we conform to the `faye.Client()` interface
    const { url, serializer, deserializer, ...options } = this.options;
    return new faye.Client(url, options);
  }

  /**
   * kick things off
   */
  public start(callback) {
    // register faye message handlers
    this.bindHandlers();
    // call any user-supplied callback from `main.ts` `app.listen()` call
    callback();
  }

  /**
   *
   */
  public bindHandlers() {
    /**
     * messageHandlers is populated by the Framework (on the `Server` superclass)
     *
     * It's a map of `pattern` -> `handler` key/value pairs
     * `handler` is the handler function in the user's controller class, decorated
     * by `@MessageHandler()` or `@EventHandler`, along with an additional boolean
     * property indicating its Nest pattern type: event or message (i.e.,
     * request/response)
     */
    this.messageHandlers.forEach((handler, pattern) => {
      // In this version (`part3`) we add the handler for events
      if (handler.isEventHandler) {
        // The only thing we need to do in the Faye subscription callback for
        // an event, since it doesn't return any data to the caller, is read
        // and decode the request, pass the inbound payload to the user-land
        // handler, and await its completion.  There's no response handling,
        // hence we don't need all the complexity of `getMessageHandler()`
        this.fayeClient.subscribe(pattern, async (rawPacket: ReadPacket) => {
          const fayeCtx = new FayeContext([pattern]);
          const packet = this.parsePacket(rawPacket);
          const message = this.deserializer.deserialize(packet, {
            channel: pattern,
          });
          // @ts-ignore
          await handler(message.data, fayeCtx);
        });
      } else {
        this.fayeClient.subscribe(
          `${pattern}_ack`,
          this.getMessageHandler(pattern, handler),
        );
      }
    });
  }

  public getMessageHandler(pattern: string, handler: Function): Function {
    return async (message: ReadPacket) => {
      const inboundPacket = this.deserializer.deserialize(message, {
        channel: pattern,
      });
      const fayeCtx = new FayeContext([pattern]);

      const response$ = this.transformToObservable(
        // @ts-ignore
        await handler(inboundPacket.data, fayeCtx),
      ) as Observable<any>;

      const publish = (response: any) => {
        Object.assign(response, { id: (message as any).id });
        const outgoingResponse = this.serializer.serialize(response);
        return this.fayeClient.publish(`${pattern}_res`, outgoingResponse);
      };

      // 框架会自动处理
      response$ && this.send(response$, publish);
    };
  }

  public parsePacket(content) {
    try {
      return JSON.parse(content);
    } catch (e) {
      return content;
    }
  }

  // error handling for faye server
  public handleError(stream: any) {
    stream.on(ERROR_EVENT, (err: any) => {
      this.logger.error('Faye Server offline!');
    });
  }

  /**
   * close() is required by `CustomTransportStrategy`...
   */
  public close() {
    this.fayeClient = null;
  }
}
