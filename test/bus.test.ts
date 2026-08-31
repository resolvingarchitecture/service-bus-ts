import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BaseService,
  ServiceBus,
  ServiceStatus,
  envelope,
  type Envelope,
} from "../src/index.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RecordingService extends BaseService {
  readonly name: string;
  readonly seen: string[] = [];
  constructor(name = "recorder") {
    super();
    this.name = name;
  }
  handle(env: Envelope): boolean {
    this.seen.push(env.id);
    return true;
  }
}

/** A protocol-adapter-shaped service, to exercise typed discovery. */
class Transport extends BaseService {
  readonly name: string;
  sent: string[] = [];
  constructor(name: string) {
    super();
    this.name = name;
  }
  handle(env: Envelope): boolean {
    this.sent.push(env.id);
    return true;
  }
}

test("register + start + discover + await", async () => {
  const bus = new ServiceBus();
  bus.start();
  const rec = new RecordingService();

  assert.equal(bus.registerAndStartService(rec), true);
  assert.equal(await bus.awaitRunning(2000, rec.name), true);

  assert.equal(bus.isRegistered(rec.name), true);
  assert.equal(bus.isRunning(rec.name), true);
  assert.equal(bus.getService(rec.name), rec);
  assert.equal(bus.getServiceStatus(rec.name), ServiceStatus.Running);
  assert.equal(bus.findRunningServices((s) => s instanceof RecordingService).length, 1);

  await bus.gracefulShutdown();
});

test("routes an envelope to a service and fires the completion callback", async () => {
  const bus = new ServiceBus();
  bus.start();
  const rec = new RecordingService();
  bus.registerAndStartService(rec);
  await bus.awaitRunning(2000, rec.name);

  const done = new Promise<void>((resolve) => {
    void bus.send(envelope(rec.name, "hi"), { onComplete: () => resolve() });
  });
  await done;
  assert.equal(rec.seen.length, 1);

  await bus.gracefulShutdown();
});

test("routing slip walks multiple services in order", async () => {
  const bus = new ServiceBus();
  bus.start();
  const a = new RecordingService("a");
  const b = new RecordingService("b");
  bus.registerAndStartServices(a, b);
  await bus.awaitRunning(2000, "a", "b");

  const e = envelope("a", "x", { slip: ["b"] });
  const done = new Promise<void>((resolve) => {
    void bus.send(e, { onComplete: () => resolve() });
  });
  await done;
  assert.equal(a.seen[0], e.id);
  assert.equal(b.seen[0], e.id);

  await bus.gracefulShutdown();
});

test("typed discovery finds all running transports", async () => {
  const bus = new ServiceBus();
  bus.start();
  bus.registerAndStartServices(new Transport("i2p"), new Transport("tor"), new RecordingService());
  await bus.awaitRunning(2000);

  const transports = bus.findRunningServices<Transport>((s) => s instanceof Transport);
  assert.equal(transports.length, 2);
  assert.deepEqual(transports.map((t) => t.name).sort(), ["i2p", "tor"]);

  await bus.gracefulShutdown();
});

test("pause and unpause", async () => {
  const bus = new ServiceBus();
  bus.start();
  const rec = new RecordingService();
  bus.registerAndStartService(rec);
  await bus.awaitRunning(2000, rec.name);

  assert.equal(await bus.pause(), true);
  assert.equal(bus.getStatus(), "paused");
  assert.equal(rec.getStatus(), ServiceStatus.Paused);
  assert.equal(await bus.unpause(), true);
  assert.equal(bus.getStatus(), "running");

  await bus.gracefulShutdown();
});

test("UNSTABLE service is restarted", async () => {
  const bus = new ServiceBus();
  bus.start();

  let starts = 0;
  class Flaky extends BaseService {
    readonly name = "flaky";
    protected override onStart(): boolean {
      starts++;
      return true;
    }
    handle(): boolean {
      return true;
    }
    trip(): void {
      this.updateStatus(ServiceStatus.Unstable);
    }
  }
  const flaky = new Flaky();
  bus.registerAndStartService(flaky);
  await bus.awaitRunning(2000, "flaky");
  assert.equal(starts, 1);

  flaky.trip();
  await sleep(100);
  assert.equal(starts, 2);

  await bus.gracefulShutdown();
});
