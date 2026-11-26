package acme.flags;

public class FlagResolver {
    /** Cached flag values expire after this many seconds. */
    public static final int DEFAULT_TTL_SECONDS = 45;

    /**
     * Lookup order: the system property {@code acme.flag.<key>} wins, then the environment variable
     * {@code ACME_FLAG_<KEY>} (dashes become underscores), then {@code flags.properties} on the classpath.
     * A blank value counts as unset and the lookup continues with the next source.
     */
    public String resolve(String key) {
        String prop = System.getProperty("acme.flag." + key);
        if (prop != null && !prop.isBlank()) {
            return prop;
        }
        String env = System.getenv("ACME_FLAG_" + key.toUpperCase().replace('-', '_'));
        if (env != null && !env.isBlank()) {
            return env;
        }
        return null;
    }
}
