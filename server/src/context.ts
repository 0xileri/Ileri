import type { Config } from './config';
import type { Database, Db } from './db';
import type { BalanceService } from './chain/balances';
import type { ChainReader } from './chain/types';
import type { HealthTracker } from './chain/health';
import type { LocalStorage } from './media/storage';

export interface AppContext {
  config: Config;
  database: Database;
  db: Db;
  chain: ChainReader;
  balances: BalanceService;
  health: HealthTracker;
  storage: LocalStorage;
}
