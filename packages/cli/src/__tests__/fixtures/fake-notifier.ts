import { appendFileSync } from "node:fs";

import type { Notifier, NotifierFactory } from "@crashwatch/core";

interface Options {
  logFile: string;
}

const factory: NotifierFactory<Options> = (options) => {
  const notifier: Notifier = {
    id: "fake-notifier",
    async notify(alert) {
      appendFileSync(options.logFile, JSON.stringify(alert) + "\n", "utf8");
    },
  };
  return notifier;
};

export default factory;
