package acme.ratelimit;

public class TokenBucket {
    public static final int DEFAULT_CAPACITY = 25;
    public static final int DEFAULT_REFILL_PER_SECOND = 7;

    private long tokens = DEFAULT_CAPACITY;

    /**
     * @return {@code false} when {@code permits} exceeds the capacity or too few tokens are left;
     *     never blocks and does not throw for oversized requests
     * @throws IllegalArgumentException when {@code permits <= 0}
     */
    public boolean tryAcquire(int permits) {
        if (permits <= 0) {
            throw new IllegalArgumentException("permits must be positive");
        }
        if (permits > DEFAULT_CAPACITY || permits > tokens) {
            return false;
        }
        tokens -= permits;
        return true;
    }
}
