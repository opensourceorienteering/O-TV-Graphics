export async function call<T = any>(
  channel: string,
  ...args: any[]
): Promise<T> {
  const result = await window.electronAPI.invoke(channel, ...args);
  if (!result?.success)
    throw new Error(
      result?.error || `Could not complete ${channel}. Try again.`,
    );
  if (channel === "templates:getAll") return result.templates as T;
  if (channel === "templates:getSets") return result.sets as T;
  return result.data as T;
}
