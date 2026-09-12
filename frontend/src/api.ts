export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Pact-Request": "1" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new ApiError(
      0,
      "Нет связи с сервером. Изменения остаются на странице. Повторите сохранение.",
    );
  }
  const json = await response
    .json()
    .catch(() => ({ detail: "Сервер временно недоступен" }));
  if (!response.ok) {
    if (response.status === 401 && path != "/login" && path != "/me")
      window.dispatchEvent(new Event("pact-session-expired"));
    const d = json.detail;
    throw new ApiError(
      response.status,
      typeof d === "string" ? d : d?.message || "Не удалось выполнить действие",
      d?.fields || {},
    );
  }
  return json;
}
