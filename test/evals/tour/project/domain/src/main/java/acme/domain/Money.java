package acme.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Money value object. Rounding is HALF_EVEN with 4 decimal places of scale. */
public record Money(BigDecimal amount, String currency) {
    public static final int SCALE = 4;

    public Money {
        amount = amount.setScale(SCALE, RoundingMode.HALF_EVEN);
    }

    public Money plus(Money other) {
        requireSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    /** Splits into {@code parts} shares; the remainder cents go to the first shares. */
    public Money[] allocate(int parts) {
        throw new UnsupportedOperationException("not implemented yet");
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("currency mismatch: " + currency + " vs " + other.currency);
        }
    }
}
