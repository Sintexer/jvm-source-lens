package acme.geo;

public final class GeoHasher {
    public static final int DEFAULT_PRECISION = 9;
    public static final int MAX_PRECISION = 11;
    private static final double LAT_LIMIT = 85.05;

    public static String encode(double lat, double lon) {
        return encode(lat, lon, DEFAULT_PRECISION);
    }

    public static String encode(double lat, double lon, int precision) {
        if (Math.abs(lat) > LAT_LIMIT) {
            throw new IllegalArgumentException("latitude outside +-" + LAT_LIMIT);
        }
        if (precision < 1 || precision > MAX_PRECISION) {
            throw new IllegalArgumentException("precision 1.." + MAX_PRECISION);
        }
        return "";
    }
}
