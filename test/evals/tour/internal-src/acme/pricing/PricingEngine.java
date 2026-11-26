package acme.pricing;

/** Internal pricing engine. Shipped as a binary jar without sources. */
public final class PricingEngine {
    public static final double MAX_DISCOUNT = 0.37;

    public double quote(double basePrice, int quantity, String tier) {
        double discount = switch (tier) {
            case "GOLD" -> 0.15;
            case "SILVER" -> 0.08;
            default -> 0.0;
        };
        if (quantity >= 100) {
            discount += 0.05;
        }
        return basePrice * quantity * (1 - Math.min(discount, MAX_DISCOUNT));
    }

    public double quote(double basePrice, int quantity) {
        return quote(basePrice, quantity, "STANDARD");
    }
}
