/**
 * service-bus: service lifecycle management and discovery over a seda-bus.
 *
 * @packageDocumentation
 */
export {
  ServiceBus,
  type ServiceBusOptions,
  type BusStatus,
  type ControlCommand,
  advance,
  envelope,
  type Envelope,
} from "./bus.js";
export {
  BaseService,
  ServiceStatus,
  type Service,
  type ServiceContext,
} from "./service.js";
export { Daemon } from "./daemon.js";

export const version = "0.1.0";
