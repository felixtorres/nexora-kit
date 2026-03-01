import Database from 'better-sqlite3';

export interface StorageDatabaseOptions {
  path: string;
  walMode?: boolean;
}

export class StorageDatabase {
  readonly db: Database.Database;

  constructor(options: StorageDatabaseOptions) {
    this.db = new Database(options.path);
    if (options.walMode !== false) {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');
  }

  close(): void {
    this.db.close();
  }
}
