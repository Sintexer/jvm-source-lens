package acme.ledger;

/** Checked: thrown when posting to a frozen ledger. */
public class LedgerFrozenException extends Exception {
    public LedgerFrozenException(String account) {
        super("frozen: " + account);
    }
}
