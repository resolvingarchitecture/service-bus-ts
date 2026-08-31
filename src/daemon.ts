/**
 * A reusable headless host for a {@link ServiceBus}.
 *
 * Subclass and override the hooks:
 *
 * ```ts
 * class MyDaemon extends Daemon {
 *   protected configName() { return "my.config"; }
 *   protected async onBusStarted(bus: ServiceBus) {
 *     bus.registerAndStartServices(new FooService(), new BarService());
 *     await bus.awaitRunning(10_000);
 *   }
 * }
 * await new MyDaemon().launch();
 * ```
 *
 * Mirrors `ra.servicebus.Daemon` in `service-bus-java`.
 */
import { readFile } from "node:fs/promises";
import { ServiceBus } from "./bus.js";

export abstract class Daemon {
  private bus?: ServiceBus;
  private stopResolve?: () => void;
  private shuttingDown = false;

  async launch(argv: string[] = process.argv.slice(2)): Promise<void> {
    const config = await this.loadConfig(argv);
    await this.beforeStart(config);

    this.bus = new ServiceBus({ config });
    this.bus.start(config);
    await this.onBusStarted(this.bus, config);

    const stop = () => void this.shutdown();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    console.log(`[${this.constructor.name}] running.`);

    await new Promise<void>((resolve) => {
      this.stopResolve = resolve;
    });
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    console.log(`[${this.constructor.name}] shutting down...`);
    try {
      await this.onStopping();
    } catch (e) {
      console.warn(`[${this.constructor.name}] onStopping() threw: ${String(e)}`);
    }
    if (this.bus) {
      const ok = await this.bus.gracefulShutdown();
      console.log(`[${this.constructor.name}] bus stopped=${ok}`);
    }
    this.stopResolve?.();
  }

  serviceBus(): ServiceBus | undefined {
    return this.bus;
  }

  // -- hooks -----------------------------------------------------

  /** Config file name looked up in the working directory. */
  protected configName(): string {
    return "service-bus.config";
  }

  /** Parse `key=value` lines from the config file, overlaid with `key=value` argv. */
  protected async loadConfig(argv: string[]): Promise<Record<string, string>> {
    const config: Record<string, string> = {};
    try {
      const text = await readFile(this.configName(), "utf8");
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq > 0) config[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
      }
    } catch {
      /* no config file - fine */
    }
    for (const arg of argv) {
      const eq = arg.indexOf("=");
      if (eq > 0) config[arg.slice(0, eq)] = arg.slice(eq + 1);
    }
    return config;
  }

  /** Before the bus is created. */
  protected async beforeStart(_config: Record<string, string>): Promise<void> {}

  /** After the bus is running - register and start services here. */
  protected async onBusStarted(
    _bus: ServiceBus,
    _config: Record<string, string>,
  ): Promise<void> {}

  /** At the start of shutdown, before the bus is stopped. */
  protected async onStopping(): Promise<void> {}
}
