package app.keylab.catalog.query;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;

import app.keylab.catalog.domain.SwitchNotFound;
import app.keylab.catalog.query.LibraryFilter.Sort;
import app.keylab.shared.paging.Cursor;
import app.keylab.shared.paging.PageQuery;
import app.keylab.shared.paging.PageResult;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * The public switch library (CAT-01 to CAT-04, US-02, US-04, US-39):
 * published switches only, filtered and paged by cursor.
 */
@Service
public class SwitchLibrary {

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

    /** @throws InvalidPageToken for a token of another sort, or one this API did not issue */
    public PageResult<SwitchRow> list(LibraryFilter filter, PageQuery page) {
        Cursor after = page.cursor();
        if (after != null && !filter.sort().wire().equals(after.value(0))) {
            // A token from another sort would move the window over the wrong rows.
            throw new InvalidPageToken();
        }
        try {
            return PageResult.of(library.published(filter, after, page.limit(), now()), page,
                    (sw) -> cursorAfter(sw, filter.sort()));
        }
        catch (IllegalArgumentException | DateTimeParseException ex) {
            throw new InvalidPageToken();
        }
    }

    /** The cursor that continues after {@code sw} in {@code sort}; it names the sort it belongs to. */
    static Cursor cursorAfter(SwitchRow sw, Sort sort) {
        if (sort == Sort.force) {
            BigDecimal force = sw.forceG() == null ? LibraryRepository.NO_FORCE : sw.forceG();
            return Cursor.of(sort.wire(), force.toPlainString(), sw.id());
        }
        return Cursor.of(sort.wire(), sw.publishedAt(), sw.id());
    }

    /** One published switch (CAT-02). Drafts and pulled switches are not found. @throws SwitchNotFound */
    public SwitchRow published(String slug) {
        return library.publishedBySlug(slug == null ? "" : slug).orElseThrow(SwitchNotFound::bySlug);
    }

    /** Ready recordings of a published switch (CAT-03). */
    public List<Recording> sounds(SwitchRow sw) {
        return library.recordings(sw.id());
    }

    /** Switches that sound like this one (CAT-04); the most similar first. */
    public List<SwitchRow> related(SwitchRow sw, int limit) {
        return library.related(sw, limit);
    }
}
