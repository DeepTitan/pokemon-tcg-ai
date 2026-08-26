export const CLIENT_EXIT_CONFIRMATION_POLLS = 3;

export interface ClientLifecycleState {
  observedRunning: boolean;
  pid: number | null;
  missingPolls: number;
}

export interface ClientLifecycleObservation {
  state: ClientLifecycleState;
  clientExited: boolean;
}

export function initialClientLifecycleState(): ClientLifecycleState {
  return { observedRunning: false, pid: null, missingPolls: 0 };
}

/**
 * Converts noisy process polling into a single reliable client-exit edge.
 * A PID replacement is an exit/relaunch; a missing process must be confirmed
 * across several polls so a transient task-list failure cannot decide a match.
 */
export function observeClientLifecycle(
  previous: ClientLifecycleState,
  running: boolean,
  pid: number | null,
): ClientLifecycleObservation {
  if (running) {
    const clientExited = previous.observedRunning
      && previous.pid != null
      && pid != null
      && previous.pid !== pid;
    return {
      state: { observedRunning: true, pid, missingPolls: 0 },
      clientExited,
    };
  }

  if (!previous.observedRunning) {
    return { state: { ...previous, pid: null, missingPolls: 0 }, clientExited: false };
  }

  const missingPolls = previous.missingPolls + 1;
  if (missingPolls < CLIENT_EXIT_CONFIRMATION_POLLS) {
    return {
      state: { ...previous, missingPolls },
      clientExited: false,
    };
  }

  return {
    state: initialClientLifecycleState(),
    clientExited: true,
  };
}
