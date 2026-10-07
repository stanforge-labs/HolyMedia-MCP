// Human approval needs only DB/session state. No external fetch is allowed.
globalThis.fetch = async () => {
  throw new Error("approval_runtime_external_transport_blocked");
};
