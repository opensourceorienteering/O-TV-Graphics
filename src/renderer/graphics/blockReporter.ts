/** Reports, once per address, what the content rules blocked on a graphics page */
import { blockedOrigin } from "../../shared/blockedAddresses";

export interface BlockedReport {
  origin: string;
  graphics: string[];
}

export function createBlockReporter(send: (report: BlockedReport) => void, graphics: () => string[]) {
  const reported = new Set<string>();
  return (event: Pick<SecurityPolicyViolationEvent, "blockedURI">) => {
    const origin = blockedOrigin(event.blockedURI);
    if (!origin || reported.has(origin)) return;
    reported.add(origin);
    send({ origin, graphics: graphics() });
  };
}
