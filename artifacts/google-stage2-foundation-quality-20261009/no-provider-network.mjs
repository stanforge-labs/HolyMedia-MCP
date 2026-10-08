// Infra tests have fake adapters only. Forbid all external fetch transports.
globalThis.fetch = async () => { throw new Error("QA_external_fetch_blocked"); };
