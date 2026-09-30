import { Injectable } from "@nestjs/common";

/**
 * How many devices a MyHealth account has allowed to receive push. The devices belong to the notification platform,
 * which this library does not import; the application registers the lookup at start-up. Until one is registered, no
 * device is known.
 */
@Injectable()
export class PushDeviceCounts {
  private lookup: ((accountId: string) => Promise<number>) | undefined;

  register(lookup: (accountId: string) => Promise<number>): void {
    this.lookup = lookup;
  }

  async count(accountId: string): Promise<number> {
    return (await this.lookup?.(accountId)) ?? 0;
  }
}
