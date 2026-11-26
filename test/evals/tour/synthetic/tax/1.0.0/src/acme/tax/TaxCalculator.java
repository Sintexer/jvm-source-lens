package acme.tax;

public class TaxCalculator {
    public static final double DEFAULT_RATE = 0.19;

    public double tax(double net) {
        return net * DEFAULT_RATE;
    }
}
