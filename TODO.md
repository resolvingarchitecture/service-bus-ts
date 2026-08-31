# service-bus (TypeScript) — TODO

## Done (0.1.0)

- [x] `Service` interface + `BaseService` (status tracking, `send`, `onStart`/`onStop`
      hooks); `ServiceStatus` enum.
- [x] `ServiceBus`: register / `registerAndStartService(s)` / `startAllRegistered`;
      `startService` / `stopService` / `unregisterService`.
- [x] Discovery: `getService(name)`, `findRunningServices(predicate)`,
      `runningServices()` / `registeredServices()`, `isRegistered` / `isRunning`.
- [x] `awaitRunning(timeoutMs, ...names)`.
- [x] `pause` / `unpause` / `shutdown` / `gracefulShutdown`.
- [x] Per-service `ServiceStatus` tracking + listeners; `Unstable` -> restart.
- [x] Control commands via `headers.command` + `headers.service`.
- [x] Reusable `Daemon` base (hooks + `launch`).
- [x] Test suite; `README.md`, `DESIGN.md`.

## Next

- [ ] `registerAndStartServiceSync(service, timeoutMs)` — register + start + await in
      one call.
- [ ] Real dependency ordering for **start** using `dependsOn()` (topological sort of
      the registered set).
- [ ] Factory registration (`register(name, () => new S())`) so `dependsOn()` can
      auto-register and so control-command `register` works over the bus.
- [ ] Richer registration result (an enum) — distinguish "already registered" from
      "failed".
- [ ] Readiness gate: hold delivery to a service until it reports `Running` (today
      the consumer is attached at registration, so envelopes can arrive mid-start).
- [ ] Health policy beyond "Unstable -> restart": restart backoff, a give-up
      threshold, `Error` handling.
- [ ] Control-command responses (ack/nack back to the sender).
- [ ] Surface seda-bus `stats()` per service.
- [ ] Publish to npm (currently `file:` dependency on `../seda-bus-ts`).
- [ ] An `examples/` pipeline.
