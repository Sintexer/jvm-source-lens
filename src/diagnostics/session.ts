import { randomUUID } from 'node:crypto';

/** One server/CLI process ≈ one agent session; shared by failure records and the call log. */
export const SESSION_ID = randomUUID();
