/** 账户「已登录」只认正向证据，避免 ACP 假就绪把 UI 打成已登录。 */
export function resolveAccountAuthenticated(input: {
  subscriptionAuthenticated?: boolean;
  email?: string | null;
}): boolean {
  return Boolean(input.subscriptionAuthenticated) || Boolean(input.email);
}
