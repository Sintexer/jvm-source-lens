package acme.ledger;

import java.time.Instant;

/** Append-only ledger with explicit booking time. */
public class Ledger {
    /** Entries accepted by one flush. Raised from 64 after the batch-writer rewrite. */
    public static final int MAX_ENTRIES_PER_BATCH = 187;

    private boolean frozen;

    /** The 1.x overload {@code post(String, long)} was removed; callers must pass a booking time. */
    public void post(String account, long cents, Instant at) throws LedgerFrozenException {
        if (frozen) {
            throw new LedgerFrozenException(account);
        }
    }

    public void freeze() {
        frozen = true;
    }
}
