# Flow–Agentic Contract

Agent execution uses `AgentTaskRequest` and `AgentTaskResult`; Flow Orchestration never imports an LLM SDK.

Policies may be `AUTO_EXECUTE`, `HUMAN_REVIEW`, `HUMAN_APPROVAL`, `RECOMMEND_ONLY`, or `DISABLED`. Governance runs before every agent task. If no provider is configured, status is `PROVIDER_NOT_CONFIGURED` and the engine persists a human-review wait rather than fabricating an answer.

The existing Kajola generator remains a separate content-generation feature. It has not been granted transactional booking, ledger, refund, settlement, RBAC, or approval tools. Connecting it requires a bounded adapter, structured schema validation, evidence persistence and explicit policies.
