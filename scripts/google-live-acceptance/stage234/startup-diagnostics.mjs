// Allowlist-only projection. Raw stdout/stderr never leaves process memory.
export function safeStartupErrors(text) {
  return text.split("\n").flatMap((line) => {
    try {
      const row = JSON.parse(line);
      if (
        ![
          "api failed to start",
          "postgres readiness failed",
          "redis readiness failed",
        ].includes(row.msg)
      )
        return [];
      return [
        {
          message: row.msg,
          error_class: /^[A-Za-z]+$/.test(row.errorType ?? "")
            ? row.errorType
            : null,
        },
      ];
    } catch {
      return [];
    }
  });
}
export function startupDiagnostics(server) {
  let tail = "";
  for (const stream of [server.stdout, server.stderr])
    stream?.on("data", (data) => {
      tail = (tail + data.toString()).slice(-32000);
    });
  return () => ({
    exit_code: server.exitCode,
    signal: server.signalCode,
    safe_errors: safeStartupErrors(tail),
  });
}
