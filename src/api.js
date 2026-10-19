let csrf = "";
// Local library identifiers also work on an HTTP LAN origin.
export function localId() {
  return (
    crypto.randomUUID?.() ??
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("")
  );
}
export function rememberState(state) {
  if (state.csrf) csrf = state.csrf;
  return state;
}
export async function api(path, body) {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-Panel-CSRF": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return rememberState(data);
}
