<div align="center">
  <h1>service-bus (TypeScript)</h1>
  <p><strong>Resolving Architecture &mdash; Clarity in Design</strong></p>
  <p>Service lifecycle management and discovery over a seda-bus.</p>
</div>

`service-bus` sits on top of
[`seda-bus`](https://github.com/resolvingarchitecture/seda-bus-ts): seda-bus moves
envelopes between named channels and walks their routing slips; `service-bus` gives
you **services** as the unit of composition &mdash; register them, start/stop/pause
them, let them find each other, and watch their health.

Each service becomes one seda-bus channel keyed by its `name`, with the service as
that channel's consumer. This is a TypeScript port of the design in
[`service-bus-java`](https://github.com/resolvingarchitecture/service-bus-java).

```ts
import { ServiceBus, BaseService, envelope, type Envelope } from "@resolvingarchitecture/service-bus";

class EchoService extends BaseService {
  readonly name = "echo";
  handle(env: Envelope) { console.log(env.payload); }
}

const bus = new ServiceBus();
bus.start();

bus.registerAndStartServices(new EchoService());
await bus.awaitRunning(5_000, "echo");

// discovery
const echo = bus.getService("echo");
const transports = bus.findRunningServices((s) => s instanceof MyProtocolService);

// send
await bus.send(envelope("echo", "hello"));
await bus.send(envelope("echo", "hello"), { onComplete: (e) => console.log("done", e.id) });

await bus.gracefulShutdown();
```

### As a daemon

```ts
import { Daemon, ServiceBus } from "@resolvingarchitecture/service-bus";

class MyDaemon extends Daemon {
  protected configName() { return "my.config"; }
  protected async onBusStarted(bus: ServiceBus) {
    bus.registerAndStartServices(new FooService(), new BarService());
    await bus.awaitRunning(10_000);
  }
}
await new MyDaemon().launch();
```

`launch` loads `key=value` config (file + argv), runs the hooks, wires SIGINT/SIGTERM,
then idles until the bus stops.

## API

| area       | methods                                                                       |
|------------|------------------------------------------------------------------------------|
| register   | `register(service)`, `registerAndStartService(s)`, `registerAndStartServices(...)` |
| lifecycle  | `startService`, `stopService`, `startAllRegistered`, `pause`/`unpause`, `shutdown`/`gracefulShutdown` |
| discovery  | `getService(name)`, `findRunningServices(predicate)`, `runningServices()`, `isRegistered`/`isRunning` |
| wait       | `awaitRunning(timeoutMs, ...names)`                                           |
| health     | `getServiceStatus(name)`, `getServiceStatuses()`, `onServiceStatus(listener)` |
| bus        | `getStatus()`, `onBusStatus(listener)`                                       |
| control    | `send` an envelope with `headers.command` (`start` / `stop` / `pause` / ...) and `headers.service` |

## Behaviour

- **Async start** &mdash; `startService` returns immediately; the service starts on a
  microtask. Join with `awaitRunning`.
- **Advisory dependencies** &mdash; `Service.dependsOn()` is checked at registration
  (warns if a dependency is not registered); it does not auto-register. Order your
  `registerAndStartServices(...)` call.
- **UNSTABLE self-healing** &mdash; a service that reports `ServiceStatus.Unstable`
  (via `updateStatus`) is stopped and restarted.
- **Control over the bus** &mdash; `send()` an envelope whose `headers.command` is a
  lifecycle command and `headers.service` names the target.
- **Dead letters** &mdash; use the underlying seda-bus:
  `bus.sedaBus().setDeadLetterChannel(source, dlq)`.

## Build

```sh
npm install     # resolves @resolvingarchitecture/seda-bus from ../seda-bus-ts (build it first)
npm test
npm run build
```

## Reference

- [`DESIGN.md`](DESIGN.md)
- [`TODO.md`](TODO.md)
