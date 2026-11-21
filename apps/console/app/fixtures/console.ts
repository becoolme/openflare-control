/** Static shell data for the console until the control-plane API is wired in. */
export const CONSOLE_FIXTURE = {
  team: { name: 'acme', initial: 'A', plan: 'Pro' },
  environment: 'production',
  user: { initials: 'AL' },
  unreadNotifications: 2,
} as const
