// UI only: actual HolyMedia session, CSRF and browser-approval endpoints decide.
const status = document.querySelector("#status"),
  plan = document.querySelector("#plan"),
  form = document.querySelector("#approval");
let nonce = location.hash.slice(1),
  csrfToken,
  busy = false;
history.replaceState(null, "", location.pathname);
async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("approval_unavailable");
  return response.json();
}
async function load() {
  if (!/^hmap_[A-Za-z0-9_-]{43}$/.test(nonce)) throw new Error("invalid_link");
  csrfToken = (await post("/acceptance/session", {})).csrfToken;
  const view = await post("/api/v1/mcp/public/approval/view", {
    approval_nonce: nonce,
  });
  const heading = document.createElement("h2");
  heading.textContent = view.campaign;
  const description = document.createElement("p");
  description.textContent = `${view.provider} · ${view.account} · ${view.after}. Ссылка действует до ${new Date(view.expires_at).toLocaleString()}.`;
  plan.append(heading, description);
  for (const item of view.stage1_items ?? []) {
    const details = document.createElement("details"),
      summary = document.createElement("summary"),
      content = document.createElement("pre");
    summary.textContent = `${item.kind ?? "Операция"}: ${item.keyword ?? item.campaign_name}`;
    content.textContent = JSON.stringify(
      { before: item.before, after: item.after, warnings: item.warnings },
      null,
      2,
    );
    details.append(summary, content);
    plan.append(details);
  }
  plan.hidden = false;
  status.textContent = view.approved
    ? "Preview уже подтверждён. Вернитесь в Codex."
    : "План проверен Google validate-only. Проверьте операции и сохраните своё решение.";
  form.hidden = Boolean(view.approved);
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !nonce) return;
  const decision = event.submitter?.value;
  if (!["approve", "cancel"].includes(decision)) return;
  busy = true;
  for (const button of form.querySelectorAll("button")) button.disabled = true;
  status.textContent = "Сохраняем решение…";
  try {
    const result = await post("/api/v1/mcp/public/approval", {
      approval_nonce: nonce,
      decision,
    });
    if (!["approved", "cancelled"].includes(result.status))
      throw new Error("unexpected_result");
    nonce = "";
    form.hidden = true;
    status.textContent =
      result.status === "approved"
        ? "Fixture preview подтверждён. Google Ads ресурсы ещё не созданы. Вернитесь в Codex."
        : "Preview отменён.";
  } catch {
    status.textContent =
      "Не удалось сохранить решение. Решение не подтверждено; попробуйте ещё раз.";
    for (const button of form.querySelectorAll("button"))
      button.disabled = false;
  } finally {
    busy = false;
  }
});
load().catch(() => {
  form.hidden = true;
  status.textContent =
    "Ссылка истекла, недействительна или недоступна. Решение не сохранено. Вернитесь в Codex.";
});
