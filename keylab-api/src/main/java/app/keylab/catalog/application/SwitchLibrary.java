package app.keylab.catalog.application;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import java.util.Set;

import app.keylab.catalog.domain.LibraryFilter;
import app.keylab.catalog.domain.LibraryFilter.Sort;
import app.keylab.catalog.domain.Switch;
import app.keylab.catalog.persistence.LibraryRepository;
import app.keylab.shared.paging.Cursor;
import app.keylab.shared.paging.PageQuery;
import app.keylab.shared.paging.PageResult;
import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.ProblemTypes;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * The public switch library (CAT-01, US-02, US-39): published switches only,
 * filtered and paged by cursor.
 */
@Service
public class SwitchLibrary {

    private static final Set<String> TYPES = Set.of("linear", "tactile", "clicky", "silent");
    private static final Set<String> PROFILES = Set.of("deep", "poppy", "clacky", "muted");
    private static final Set<String> SOUNDS = Set.of("recorded", "missing");
    private static final int MAX_Q = 60;

    private final LibraryRepository library;
    private final Clock clock;

    @Autowired
    SwitchLibrary(LibraryRepository library) {
        this(library, Clock.systemUTC());
    }

    SwitchLibrary(LibraryRepository library, Clock clock) {
        this.library = library;
        this.clock = clock;
    }

    public Instant now() {
        return clock.instant();
    }

    /** @throws ApiProblem 400 invalid_parameter, invalid_page_token */
    public PageResult<Switch> list(Params params, PageQuery page) {
        LibraryFilter filter = params.toFilter();
        Cursor after = page.cursor();
        if (after != null && !filter.sort().wire().equals(after.value(0))) {
            // A token from another sort would move the window over the wrong rows.
            throw ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_page_token",
                    "page_token is not a token from a previous page");
        }
        try {
            return PageResult.of(library.published(filter, after, page.limit(), now()), page,
                    (sw) -> LibraryRepository.cursorAfter(sw, filter.sort()));
        }
        catch (IllegalArgumentException | java.time.format.DateTimeParseException ex) {
            throw ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_page_token",
                    "page_token is not a token from a previous page");
        }
    }

    /** The raw query parameters of CAT-01, checked by {@link #toFilter()}. */
    public record Params(String type, String profile, String sound, String q, String isNew, String forceMin,
            String forceMax, String sort) {

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
            return ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_parameter", "A query parameter is not valid",
                    detail);
        }
    }
}
