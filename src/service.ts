import type { Envelope } from "@resolvingarchitecture/seda-bus";

/** Lifecycle state of a service on the bus. */
export enum ServiceStatus {
  NotInitialized = "not_initialized",
  Starting = "starting",
  Running = "running",
  Paused = "paused",
  /** Degraded / self-reported broken - the bus restarts it. */
  Unstable = "unstable",
  ShuttingDown = "shutting_down",
  Shutdown = "shutdown",
  Error = "error",
}

/** What a service is handed by the bus so it can send envelopes back. */
export interface ServiceContext {
  /** The effective config (bus config merged with any per-service overrides). */
  readonly config: Record<string, string>;
  /** Publish an envelope onto the bus. */
  send(env: Envelope, opts?: { onComplete?: (e: Envelope) => void }): Promise<boolean>;
}

/**
 * A unit of composition on the {@link ServiceBus}. Each service becomes one
 * seda-bus channel keyed by {@link Service.name}, with the service as that
 * channel's consumer.
 */
export interface Service {
  /** Unique name: the registration key, the channel name, the routing target. */
  readonly name: string;

  /** Names of services that must be started before this one. Advisory ordering. */
  dependsOn(): string[];

  /** Handle an envelope routed to this service. Return `false` to nack. */
  handle(env: Envelope): boolean | void | Promise<boolean | void>;

  start(): boolean | Promise<boolean>;
  stop(): boolean | Promise<boolean>;
  pause(): void;
  unpause(): void;

  getStatus(): ServiceStatus;
}

type StatusObserver = (name: string, status: ServiceStatus) => void;

/**
 * Base implementation: tracks status, exposes `send`, and turns lifecycle
 * calls into status transitions. Override {@link handle} (and optionally
 * {@link onStart} / {@link onStop}).
 */
export abstract class BaseService implements Service {
  abstract readonly name: string;

  protected ctx!: ServiceContext;
  private status: ServiceStatus = ServiceStatus.NotInitialized;
  private observer?: StatusObserver;

  /** @internal wired by {@link ServiceBus.register} */
  bind(ctx: ServiceContext, observer: StatusObserver): void {
    this.ctx = ctx;
    this.observer = observer;
  }

  dependsOn(): string[] {
    return [];
  }

  abstract handle(env: Envelope): boolean | void | Promise<boolean | void>;

  async start(): Promise<boolean> {
    this.updateStatus(ServiceStatus.Starting);
    const ok = await this.onStart();
    this.updateStatus(ok ? ServiceStatus.Running : ServiceStatus.Error);
    return ok;
  }

  async stop(): Promise<boolean> {
    this.updateStatus(ServiceStatus.ShuttingDown);
    const ok = await this.onStop();
    this.updateStatus(ServiceStatus.Shutdown);
    return ok;
  }

  pause(): void {
    this.updateStatus(ServiceStatus.Paused);
  }

  unpause(): void {
    this.updateStatus(ServiceStatus.Running);
  }

  getStatus(): ServiceStatus {
    return this.status;
  }

  /** Report a new status (e.g. `ServiceStatus.Unstable` to ask for a restart). */
  protected updateStatus(status: ServiceStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.observer?.(this.name, status);
  }

  protected send(
    env: Envelope,
    opts?: { onComplete?: (e: Envelope) => void },
  ): Promise<boolean> {
    return this.ctx.send(env, opts);
  }

  /** Override for startup work. Return false to fail the start. */
  protected onStart(): boolean | Promise<boolean> {
    return true;
  }

  /** Override for shutdown work. */
  protected onStop(): boolean | Promise<boolean> {
    return true;
  }
}
