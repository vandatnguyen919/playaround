package app.keylab.catalog.adapter.in.web;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import app.keylab.catalog.query.LibraryFilter;
import app.keylab.catalog.query.LibraryFilter.Sort;
import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.ProblemTypes;

/**
 * The raw query parameters of CAT-01, checked by {@link #toFilter()}, and the
 * {@code include} of CAT-02. A bad value is {@code 400 invalid_parameter}.
 */
record LibraryParams(String type, String profile, String sound, String q, String isNew, String forceMin,
        String forceMax, String sort) {

    private static final Set<String> TYPES = Set.of("linear", "tactile", "clicky", "silent");
    private static final Set<String> PROFILES = Set.of("deep", "poppy", "clacky", "muted");
    private static final Set<String> SOUNDS = Set.of("recorded", "missing");
    private static final int MAX_Q = 60;

    /** @throws ApiProblem 400 invalid_parameter */
    LibraryFilter toFilter() {
        String query = blank(q) ? null : q.trim();
        if (query != null && query.length() > MAX_Q) {
            throw invalid("q", "q is at most " + MAX_Q + " characters");
        }
        Sort order = blank(sort) ? Sort.popular : Sort.fromWire(sort.trim());
        if (order == null) {
            throw invalid("sort", "sort is popular, -publishedAt or force");
        }
        BigDecimal min = number("force_min", forceMin);
        BigDecimal max = number("force_max", forceMax);
        return new LibraryFilter(oneOf("type", type, TYPES), oneOf("profile", profile, PROFILES),
                oneOf("sound", sound, SOUNDS), query, bool("is_new", isNew), min, max, order);
    }

    /**
     * What {@code include} asks for on CAT-02: any of {@code sounds},
     * {@code related}, comma separated. @throws ApiProblem 400 invalid_parameter
     */
    static Set<String> includes(String include) {
        if (include == null || include.isBlank()) {
            return Set.of();
        }
        List<String> names = new ArrayList<>();
        for (String part : include.split(",")) {
            String name = part.trim().toLowerCase(Locale.ROOT);
            if (!name.equals("sounds") && !name.equals("related")) {
                throw ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_parameter", "A query parameter is not valid",
                        "include is sounds, related or both");
            }
            names.add(name);
        }
        return Set.copyOf(names);
    }

    private static String oneOf(String name, String value, Set<String> allowed) {
        if (blank(value)) {
            return null;
        }
        String v = value.trim().toLowerCase(Locale.ROOT);
        if (!allowed.contains(v)) {
            throw invalid(name, name + " is one of " + String.join(", ", allowed.stream().sorted().toList()));
        }
        return v;
    }

    private static Boolean bool(String name, String value) {
        if (blank(value)) {
            return null;
        }
        return switch (value.trim()) {
            case "true" -> true;
            case "false" -> false;
            default -> throw invalid(name, name + " is true or false");
        };
    }

    private static BigDecimal number(String name, String value) {
        if (blank(value)) {
            return null;
        }
        try {
            BigDecimal n = new BigDecimal(value.trim());
            if (n.signum() < 0 || n.compareTo(BigDecimal.valueOf(1000)) > 0) {
                throw invalid(name, name + " is grams, 0 to 1000");
            }
            return n;
        }
        catch (NumberFormatException ex) {
            throw invalid(name, name + " is grams, 0 to 1000");
        }
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static ApiProblem invalid(String name, String detail) {
        return ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_parameter", "A query parameter is not valid", detail);
    }
}
