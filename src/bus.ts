/**
 * Service lifecycle management and discovery over a {@link SedaBus}.
 *
 * seda-bus is a transport: named channels, a worker pool, bounded queues, the
 * routing-slip engine. It has no notion of a "service". `ServiceBus` adds that:
 * register services, start / stop / pause them, let them find each other, and
 * watch their health. Each service becomes one seda-bus channel keyed by its
 * name, with the service as that channel's consumer.
 *
 * Mirrors the design of `service-bus-java`.
 */
import {
  SedaBus,
  advance,
  envelope,
  type Envelope,
} from "@resolvingarchitecture/seda-bus";
import {
  BaseService,
  ServiceStatus,
  type Service,
  type ServiceContext,
} from "./service.js";

export type BusStatus = "stopped" | "starting" | "running" | "paused" | "stopping";

/** Lifecycle command carried on `envelope.headers.command`. */
export type ControlCommand =
  | "register"
  | "unregister"
  | "start"
  | "stop"
  | "pause"
  | "unpause";

export interface ServiceBusOptions {
  /** Supply a pre-built seda-bus; otherwise one is created. */
  seda?: SedaBus;
  /** Config handed to every service's context. */
  config?: Record<string, string>;
  /** Concurrency cap passed through to a created seda-bus. */
  concurrency?: number;
}

type ServiceStatusListener = (name: string, status: ServiceStatus) => void;
type BusStatusListener = (status: BusStatus) => void;

export class ServiceBus {
  private readonly seda: SedaBus;
  private readonly config: Record<string, string>;

  private readonly registered = new Map<string, Service>();
  private readonly running = new Map<string, Service>();
  private readonly statuses = new Map<string, ServiceStatus>();

  private readonly serviceStatusListeners = new Set<ServiceStatusListener>();
  private readonly busStatusListeners = new Set<BusStatusListener>();

  private status: BusStatus = "stopped";

  constructor(opts: ServiceBusOptions = {}) {
    this.seda = opts.seda ?? new SedaBus({ concurrency: opts.concurrency });
    this.config = { ...(opts.config ?? {}) };
  }

  // -- lifecycle ---------------------------------------------------

  start(config?: Record<string, string>): void {
    this.updateStatus("starting");
    if (config) Object.assign(this.config, config);
    this.seda.resume();
    this.updateStatus("running");
  }

  async pause(): Promise<boolean> {
    if (this.status !== "running") return false;
    for (const s of this.running.values()) s.pause();
    this.seda.pause();
    this.updateStatus("paused");
    return true;
  }

  async unpause(): Promise<boolean> {
    if (this.status !== "paused") return false;
    this.seda.resume();
    for (const s of this.running.values()) s.unpause();
    this.updateStatus("running");
    return true;
  }

  async shutdown(): Promise<boolean> {
    return this.doShutdown(false, 5_000);
  }

  async gracefulShutdown(): Promise<boolean> {
    return this.doShutdown(true, 30_000);
  }

  private async doShutdown(graceful: boolean, timeoutMs: number): Promise<boolean> {
    this.updateStatus("stopping");
    const names = [...this.running.keys()];
    await Promise.all(
      names.map(async (name) => {
        const s = this.running.get(name);
        if (!s) return;
        try {
          if (await s.stop()) this.running.delete(name);
        } catch (e) {
          console.warn(`[ServiceBus] ${name}.stop() threw: ${String(e)}`);
        }
      }),
    );
    const busOk = graceful
      ? await this.seda.shutdown({ timeoutMs })
      : (await this.seda.shutdownNow(), true);
    this.updateStatus("stopped");
    return busOk && this.running.size === 0;
  }

  getStatus(): BusStatus {
    return this.status;
  }

  // -- registration ----------------------------------------------

  /** Register a service and wire it as its channel's consumer. */
  register(service: Service): boolean {
    if (this.registered.has(service.name)) return true;

    for (const dep of service.dependsOn()) {
      if (!this.registered.has(dep)) {
        console.warn(
          `[ServiceBus] ${service.name} depends on unregistered "${dep}"; register it first`,
        );
      }
    }

    const ctx: ServiceContext = {
      config: this.config,
      send: (env, opts) => this.send(env, opts),
    };
    const observer: ServiceStatusListener = (n, s) => this.serviceStatusChanged(n, s);
    if (service instanceof BaseService) service.bind(ctx, observer);

    this.seda.channel(service.name);
    this.seda.subscribe(service.name, (env) => service.handle(env));

    this.registered.set(service.name, service);
    this.statuses.set(service.name, ServiceStatus.NotInitialized);
    return true;
  }

  /** Start a registered service. Non-blocking; join with {@link awaitRunning}. */
  startService(name: string): boolean {
    const s = this.registered.get(name);
    if (!s) {
      console.warn(`[ServiceBus] not registered, cannot start: ${name}`);
      return false;
    }
    if (this.running.has(name)) return true;
    void Promise.resolve()
      .then(() => s.start())
      .then((ok) => {
        if (ok) this.running.set(name, s);
        else console.warn(`[ServiceBus] failed to start: ${name}`);
      })
      .catch((e) => console.warn(`[ServiceBus] ${name}.start() threw: ${String(e)}`));
    return true;
  }

  stopService(name: string): boolean {
    const s = this.running.get(name);
    if (!s) return true;
    void Promise.resolve()
      .then(() => s.stop())
      .then((ok) => {
        if (ok) this.running.delete(name);
      });
    return true;
  }

  unregisterService(name: string): boolean {
    this.stopService(name);
    this.registered.delete(name);
    this.statuses.delete(name);
    return true;
  }

  /** Register then start. */
  registerAndStartService(service: Service): boolean {
    return this.register(service) && this.startService(service.name);
  }

  registerAndStartServices(...services: Service[]): void {
    for (const s of services) this.registerAndStartService(s);
  }

  startAllRegistered(): void {
    for (const name of this.registered.keys()) {
      if (!this.running.has(name)) this.startService(name);
    }
  }

  /** Resolve once the named services (or all registered) are running, or timeout. */
  async awaitRunning(timeoutMs: number, ...names: string[]): Promise<boolean> {
    const targets = names.length > 0 ? names : [...this.registered.keys()];
    const deadline = Date.now() + timeoutMs;
    const done = () => targets.every((n) => this.running.has(n));
    while (!done() && Date.now() < deadline) {
      await sleep(20);
    }
    return done();
  }

  // -- discovery ------------------------------------------------

  registeredServiceNames(): string[] {
    return [...this.registered.keys()];
  }

  runningServiceNames(): string[] {
    return [...this.running.keys()];
  }

  registeredServices(): Service[] {
    return [...this.registered.values()];
  }

  runningServices(): Service[] {
    return [...this.running.values()];
  }

  /** The service registered under `name`, running or not. */
  getService<T extends Service = Service>(name: string): T | undefined {
    return this.registered.get(name) as T | undefined;
  }

  /** Running services matching a predicate - e.g. `s => s instanceof ProtocolService`. */
  findRunningServices<T extends Service = Service>(
    predicate: (s: Service) => boolean,
  ): T[] {
    return [...this.running.values()].filter(predicate) as T[];
  }

  isRegistered(name: string): boolean {
    return this.registered.has(name);
  }

  isRunning(name: string): boolean {
    return this.running.has(name);
  }

  getServiceStatus(name: string): ServiceStatus | undefined {
    return this.statuses.get(name);
  }

  getServiceStatuses(): Record<string, ServiceStatus> {
    return Object.fromEntries(this.statuses);
  }

  // -- status observation -------------------------------------

  onBusStatus(l: BusStatusListener): void {
    this.busStatusListeners.add(l);
  }

  onServiceStatus(l: ServiceStatusListener): void {
    this.serviceStatusListeners.add(l);
  }

  serviceStatusChanged(name: string, status: ServiceStatus): void {
    this.statuses.set(name, status);
    for (const l of this.serviceStatusListeners) {
      try {
        l(name, status);
      } catch (e) {
        console.warn(`[ServiceBus] service-status listener threw: ${String(e)}`);
      }
    }
    if (status === ServiceStatus.Unstable) {
      const s = this.registered.get(name);
      if (s) {
        console.warn(`[ServiceBus] ${name} UNSTABLE; restarting...`);
        void Promise.resolve()
          .then(() => s.stop())
          .then(() => s.start())
          .then((ok) => {
            if (ok) this.running.set(name, s);
          });
      }
    }
  }

  private updateStatus(status: BusStatus): void {
    this.status = status;
    for (const l of this.busStatusListeners) {
      try {
        l(status);
      } catch (e) {
        console.warn(`[ServiceBus] bus-status listener threw: ${String(e)}`);
      }
    }
  }

  // -- messaging ---------------------------------------------

  /**
   * Publish an envelope. If `headers.command` is a {@link ControlCommand} the
   * bus acts on it (`headers.service` names the target) before publishing.
   */
  async send(
    env: Envelope,
    opts?: { onComplete?: (e: Envelope) => void },
  ): Promise<boolean> {
    const command = env.headers.command as ControlCommand | undefined;
    if (command) this.processCommand(command, env);
    return this.seda.publish(env, opts);
  }

  /** The underlying seda-bus. Rarely needed. */
  sedaBus(): SedaBus {
    return this.seda;
  }

  private processCommand(command: ControlCommand, env: Envelope): void {
    const name = env.headers.service;
    if (!name) {
      console.warn(`[ServiceBus] control command "${command}" with no headers.service`);
      return;
    }
    switch (command) {
      case "start":
        this.startService(name);
        break;
      case "stop":
        this.stopService(name);
        break;
      case "unregister":
        this.unregisterService(name);
        break;
      case "pause":
        this.registered.get(name)?.pause();
        break;
      case "unpause":
        this.registered.get(name)?.unpause();
        break;
      case "register":
        console.warn(`[ServiceBus] "register" over the bus needs a factory; ignored`);
        break;
    }
  }
}

// re-exports so callers need one import
export { advance, envelope, type Envelope };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
