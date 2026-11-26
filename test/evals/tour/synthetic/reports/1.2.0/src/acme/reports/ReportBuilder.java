package acme.reports;

import acme.ledger.Ledger;

public class ReportBuilder {
    /** Hard row cap; larger reports are cut and flagged truncated. */
    public static final int MAX_ROWS = 5000;

    public ReportBuilder(Ledger ledger) {
    }
}
