package app.keylab.shared.paging;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;

import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.ProblemTypes;

/**
 * Where a page stopped: the sort key values of its last row, for a keyset
 * query such as {@code WHERE (published_at, id) < (?, ?)}. On the wire it is
 * an opaque, URL-safe {@code page_token}; clients only hand it back.
 *
 * <p>It is not signed. A cursor holds sort keys, never access rules, so a
 * forged one can only move the window over rows the caller may already list.
 *
 * @param values the last row's sort key values, in sort order
 */
public record Cursor(List<String> values) {

    private static final String VERSION = "1";
    /** Unit separator: cannot appear in a slug, a UUID, a number or a timestamp. */
    private static final String SEPARATOR = "\u001F";

    public Cursor {
        if (values == null || values.isEmpty()) {
            throw new IllegalArgumentException("A cursor needs at least one value");
        }
        if (values.stream().anyMatch((value) -> value == null || value.contains(SEPARATOR))) {
            throw new IllegalArgumentException("Cursor values must be non-null text without control separators");
        }
        values = List.copyOf(values);
    }

    public static Cursor of(Object... values) {
        return new Cursor(Arrays.stream(values).map(String::valueOf).toList());
    }

    /** The {@code page_token} for this cursor. */
    public String encode() {
        String raw = VERSION + SEPARATOR + String.join(SEPARATOR, values);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    /** Reads a {@code page_token}. Anything this class did not write is 400 invalid_page_token. */
    public static Cursor decode(String token) {
        try {
            String raw = new String(Base64.getUrlDecoder().decode(token), StandardCharsets.UTF_8);
            String[] parts = raw.split(SEPARATOR, -1);
            if (parts.length < 2 || !VERSION.equals(parts[0])) {
                throw invalid();
            }
            return new Cursor(List.of(parts).subList(1, parts.length));
        }
        catch (IllegalArgumentException ex) {
            throw invalid();
        }
    }

    public String value(int index) {
        if (index >= values.size()) {
            throw invalid();
        }
        return values.get(index);
    }

    private static ApiProblem invalid() {
        return ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_page_token",
                "page_token is not a token from a previous page");
    }
}
