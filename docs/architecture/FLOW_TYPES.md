# Flow Type Support

| Flow type | Status | Evidence |
|---|---|---|
| Sequential | CERTIFIED | Unit test and booking golden flow |
| Conditional | CERTIFIED | Payment-route decision and unit test |
| Parallel | CERTIFIED | Confirmation/completion forks |
| Fan-out/Fan-in | CERTIFIED | `ALL` joins and unit test |
| Event-driven | CERTIFIED | Payment and completion waits |
| Human-in-the-loop | IMPLEMENTED | Assignment/ownership/tenant unit test |
| Agentic | IMPLEMENTED | Governance + provider-not-configured human fallback test |
| Hybrid | IMPLEMENTED | Agent fallback contract; no production agent flow |
| Scheduled | IMPLEMENTED | Persisted timer status and resume unit test |
| Long-running | IMPLEMENTED | Repository-backed wait/resume; production worker pending |
| Saga | IMPLEMENTED | Backward compensation unit test |
| Subflow | IMPLEMENTED | Version-pinned child-flow unit test |
| State-machine | CERTIFIED | Booking business state remains domain-owned |
| Rule-driven | PARTIAL | Existing automation engine retained; flow trigger adapter pending |
| Dynamic routing | IMPLEMENTED | Registry/edge decisions; domain certification pending |
| Choreography interoperability | IMPLEMENTED | Non-critical automation remains event-driven |

`CERTIFIED` here means executed in the local controlled runtime. Production durability is assessed separately in `OS_CERTIFICATION.md`.
