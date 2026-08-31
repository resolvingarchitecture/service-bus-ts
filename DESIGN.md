# service-bus (TypeScript) — Design

A port of [`service-bus-java`](https://github.com/resolvingarchitecture/service-bus-java)'s
design onto [`seda-bus-ts`](https://github.com/resolvingarchitecture/seda-bus-ts).
Same model, idiomatic to TypeScript / Node.

## Role

`seda-bus` is a transport: named channels, an event-loop worker pool, bounded
queues, the routing-slip engine. It has no notion of a "service".

`service-bus` adds that notion and everything that comes with managing a set of
them:

- **composition** — a `Service` is the unit; each becomes one channel + its
  consumer;
- **lifecycle** — register, start, stop, pause, restart, for individual services and
  for the whole bus;
- **discovery** — services and hosts look each other up by name or by type;
- **health** — per-service `ServiceStatus` is tracked, published to listeners, and an
  `Unstable` service is stopped and restarted;
- **remote control** — an envelope carrying `headers.command` acts on a service;
- **a reusable `Daemon`** host.

## Model

    ServiceBus
      seda                 SedaBus (created, or supplied)
      registered           name -> Service
      running              name -> Service
      statuses             name -> ServiceStatus
      serviceStatusListeners / busStatusListeners

    register(service):
      wire ctx (config + send) and a status observer onto the service
      seda.channel(service.name)
      seda.subscribe(service.name, env => service.handle(env))

    startService(name):  microtask -> service.start() -> running.set(name, service)
    send(env):           if headers.command -> processCommand;  seda.publish(env)

"name" is the registration key, the channel name, and the value a routing slip
carries (`envelope.to` / `envelope.slip[]`).

## Differences from `service-bus-java` (and why)

| java | here | reason |
|------|------|--------|
| reflective `Class.forName` registration | pass a `Service` instance | no reflection; the instance carries its own `name` |
| dependency-ordered auto-registration | `dependsOn()` is advisory (warn only) | can't instantiate an unknown dependency without a factory; caller orders `registerAndStartServices` |
| `AppThread` per start/stop | a microtask (`Promise.resolve().then`) | Node is single-threaded; "async, join later" is kept via `awaitRunning` |
| `findRunningServices(Class)` | `findRunningServices(predicate)` | no `Class` tokens; `s => s instanceof Foo` is the idiom |
| `ControlCommand` enum on the envelope | `headers.command` string + `headers.service` | seda-bus envelopes carry string headers, not a typed command path |
| `PersistDeadLetter` file with rotation | `seda.setDeadLetterChannel(source, dlq)` | seda-bus-ts already models a dead-letter channel |
| routing slip is a LIFO stack | seda-bus-ts slip is FIFO | property of the underlying bus; the router pattern is unchanged |

## Async start and `awaitRunning`

`startService` kicks `service.start()` onto a microtask and returns. `awaitRunning(
timeoutMs, ...names)` polls until the named services (or all registered) are in
`running`. Daemons call it after `onBusStarted`; tests call it before asserting.

## Status and self-healing

A `BaseService` calls `updateStatus(status)`, which reaches
`ServiceBus.serviceStatusChanged(name, status)`. The bus records it, forwards it to
every service-status listener, and on `ServiceStatus.Unstable` stops and restarts
the service.

## Daemon

`Daemon` is an abstract class with `configName` / `loadConfig` / `beforeStart` /
`onBusStarted` / `onStopping` hooks and a `launch(argv)` that loads config, runs the
hooks, wires SIGINT/SIGTERM, and idles on a promise until `shutdown()` resolves it.

## Not here

- No priority or weighting between services (that is seda-bus per-stage config).
- No distributed registry — one process, one bus.
- No hot reload — restart re-runs `start()` on the same instance.
