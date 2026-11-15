package app.keylab.shared.concurrency;

/**
 * Entity tags for optimistic concurrency. A GET returns the resource's
 * {@code ETag}; the client sends it back as {@code If-Match} on PATCH and
 * DELETE (api-design-v1.md, Conventions, Concurrency).
 */
public final class ETags {

    private ETags() {
    }

    /** A strong tag from a row version, for example a JPA {@code @Version}: 7 becomes "7". */
    public static String of(long version) {
        return "\"" + version + "\"";
    }

    /** A strong tag from any opaque text, such as a content hash. */
    public static String of(String opaque) {
        if (opaque == null || opaque.isEmpty() || opaque.contains("\"")) {
            throw new IllegalArgumentException("An entity tag needs text without quotes");
        }
        return "\"" + opaque + "\"";
    }
}
