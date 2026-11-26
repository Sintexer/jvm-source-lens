package acme.ledger;

/** Append-only ledger. */
public class Ledger {
    /** Entries accepted by one flush. */
    public static final int MAX_ENTRIES_PER_BATCH = 64;

    private boolean frozen;

    public void post(String account, long cents) {
        if (frozen) {
            throw new IllegalStateException("ledger frozen");
        }
    }

    public void freeze() {
        frozen = true;
    }
}
