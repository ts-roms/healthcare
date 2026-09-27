import { Inject, Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { DATABASE, type Database, PERMISSIONS } from "@healthcare/core";
import { permission } from "./auth.schema";

/** Refuses to start if the code permission catalog and the database disagree. */
@Injectable()
export class PermissionCatalogCheck implements OnApplicationBootstrap {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationBootstrap(): Promise<void> {
    const rows = await this.db.select({ key: permission.key }).from(permission);
    const inDatabase = new Set(rows.map((row) => row.key));
    const inCode = new Set<string>(PERMISSIONS);
    const missingInDb = [...inCode].filter((key) => !inDatabase.has(key));
    const missingInCode = [...inDatabase].filter((key) => !inCode.has(key));
    if (missingInDb.length || missingInCode.length) {
      throw new Error(
        `Permission catalog drift. Missing in database: [${missingInDb.join(", ")}]; missing in code: [${missingInCode.join(", ")}]. Add a migration.`,
      );
    }
  }
}
