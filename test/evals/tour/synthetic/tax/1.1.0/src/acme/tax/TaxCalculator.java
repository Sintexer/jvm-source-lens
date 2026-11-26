package acme.tax;

public class TaxCalculator {
    /** Raised from 0.19 to 0.21 in 1.1.0. */
    public static final double DEFAULT_RATE = 0.21;

    public double tax(double net) {
        return net * DEFAULT_RATE;
    }

    /** Regional rates: DE 0.19, FR 0.20, SE 0.25; every other region falls back to {@link #DEFAULT_RATE}. */
    public double forRegion(String region, double net) {
        return net * switch (region) {
            case "DE" -> 0.19;
            case "FR" -> 0.20;
            case "SE" -> 0.25;
            default -> DEFAULT_RATE;
        };
    }
}
