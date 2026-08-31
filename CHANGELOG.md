# Changelog

## 0.1.0

Initial release. A TypeScript port of `service-bus-java`'s design onto
`seda-bus-ts`.

- `Service` / `BaseService` / `ServiceStatus`.
- `ServiceBus`: register, start/stop/pause/restart, discovery (`getService`,
  `findRunningServices`), `awaitRunning`, per-service status + listeners,
  `Unstable` -> restart, control commands via envelope headers.
- Reusable `Daemon` base (`configName` / `beforeStart` / `onBusStarted` /
  `onStopping` + `launch`).
- Depends on `@resolvingarchitecture/seda-bus` (`file:../seda-bus-ts`).
