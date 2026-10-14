const NOTIFICATION_CLOCK_INTERVAL_MS = 5_000;
const worker = self as unknown as { postMessage: (timestamp: number) => void };

function publishCurrentTime() {
  worker.postMessage(Date.now());
}

publishCurrentTime();
setInterval(publishCurrentTime, NOTIFICATION_CLOCK_INTERVAL_MS);

export {};
