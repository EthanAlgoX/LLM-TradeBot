export type DataCenterHostTransition =
  | "mounted"
  | "unmounted"
  | "unchanged";

export interface DataCenterHostLifecycle<Host> {
  current(): Host | null;
  sync(nextHost: Host | null): DataCenterHostTransition;
}

export function createDataCenterHostLifecycle<Host>(
  onMount: (host: Host) => void,
  onUnmount: (host: Host) => void = () => undefined,
): DataCenterHostLifecycle<Host> {
  let currentHost: Host | null = null;

  return {
    current: () => currentHost,
    sync(nextHost) {
      if (nextHost === currentHost) {
        return "unchanged";
      }

      const previousHost = currentHost;
      currentHost = nextHost;

      if (previousHost !== null) {
        onUnmount(previousHost);
      }
      if (nextHost !== null) {
        onMount(nextHost);
        return "mounted";
      }
      return "unmounted";
    },
  };
}
